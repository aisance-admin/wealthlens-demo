"""Adapter: WealthLens note fields -> EvidenceInvest pricing engine.

The engine in server/engine/ is vendored verbatim from the EvidenceInvest
handoff and is not edited. Everything that translates WealthLens vocabulary
into the engine's contract lives here, so the vendored code stays diffable
against the original.

Pipeline (all real engine code, only the ORM/DB wrapper is bypassed):

    simulate_paths()               -> Monte-Carlo paths      (monte_carlo.py)
    evaluate_paths(paths, params)  -> fair value, probs      (payoff_evaluator.py)
    purchase - fair_value          -> bank markup
    MarginDetector.analyze_from_params() -> margin breakdown (margin_detector.py)

Every assumption that moves the number is echoed back in `assumptions` — an
auditor tool must never present a valuation whose inputs are invisible.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Optional

import numpy as np

from engine.margin_detector import MarginDetector
from engine.monte_carlo import simulate_paths
from engine.payoff_evaluator import PayoffParams, evaluate_paths

# ── Defaults ───────────────────────────────────────────────────
# Risk-free rate per currency. The engine defaults to 18% (Russian rates);
# WealthLens portfolios are mostly USD/EUR/CHF, where that would be badly wrong.
DEFAULT_RATES = {
    "USD": 0.042,
    "EUR": 0.024,
    "CHF": 0.010,
    "GBP": 0.041,
    "JPY": 0.009,
    "RUB": 0.180,
}

# Indicative annualised volatility by underlying. Broad indices are calmer than
# single names; used only when the caller supplies no volatility.
DEFAULT_VOLS = {
    "S&P 500": 0.18,
    "SPX": 0.18,
    "EUROSTOXX 50": 0.20,
    "EURO STOXX 50": 0.20,
    "ESTX50": 0.20,
    "NASDAQ 100": 0.23,
    "NDX": 0.23,
    "DAX": 0.19,
    "FTSE 100": 0.16,
    "NIKKEI 225": 0.21,
    "IMOEX": 0.28,
}
# Dividend yield by underlying. Decisive for index-linked notes: a price index
# drifts at (r - q) under the risk-neutral measure, so omitting q inflates the
# valuation and understates the issuer's margin. DAX is a TOTAL-RETURN index —
# dividends are already inside it, hence 0.
DEFAULT_DIVS = {
    "S&P 500": 0.013, "SPX": 0.013,
    "EUROSTOXX 50": 0.034, "EURO STOXX 50": 0.034, "ESTX50": 0.034,
    "NASDAQ 100": 0.007, "NDX": 0.007,
    "DAX": 0.000,
    "FTSE 100": 0.036,
    "NIKKEI 225": 0.018,
    "IMOEX": 0.085,
}
FALLBACK_DIV = 0.020         # unknown underlying: assume a typical single name

FALLBACK_VOL = 0.22          # unknown underlying: assume single-name-ish risk
ENGINE_MAX_STEPS = 1500   # см. monte_carlo.MAX_STEPS — жёсткий предел ядра
FALLBACK_CREDIT_SPREAD = 0.025  # 250bp issuer spread over the risk-free curve

_FREQ_PER_YEAR = {"monthly": 12, "quarterly": 4, "semiannual": 2, "annual": 1}


def _lookup(table: dict, underlying: Optional[str], fallback: float) -> tuple[float, bool]:
    """Return (value, is_known). Matching is case- and space-insensitive."""
    if not underlying:
        return fallback, False
    key = " ".join(str(underlying).upper().split())
    if key in table:
        return table[key], True
    for name, value in table.items():
        if name in key or key in name:
            return value, True
    return fallback, False


def price_note(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Price one structured note and decompose the issuer's margin.

    Accepts WealthLens note fields; returns fair value, probabilities and the
    margin breakdown, plus every assumption used.
    """
    def num(key: str, default: float) -> float:
        raw = payload.get(key)
        if raw is None or raw == "":
            return default
        try:
            return float(raw)
        except (TypeError, ValueError):
            return default

    currency = str(payload.get("currency") or "USD").upper()
    underlying = payload.get("underlying") or ""
    product_type = str(payload.get("product_type") or "phoenix").lower()

    # Levels arrive as percentages in WealthLens (65 = 65%), the engine wants fractions.
    barrier_level = num("barrier", 65.0) / 100.0
    coupon_rate = num("coupon", 0.0) / 100.0
    capital_protection = num("capital_protection", 0.0) / 100.0
    purchase_price = num("purchase_price", 100.0) / 100.0
    nominal = num("nominal", 1_000_000.0)
    total_years = max(num("maturity_years", 3.0), 0.25)

    coupon_frequency = str(payload.get("coupon_frequency") or "quarterly").lower()
    periods_per_year = _FREQ_PER_YEAR.get(coupon_frequency, 4)
    coupon_type = str(payload.get("coupon_type") or "conditional").lower()
    barrier_type = str(payload.get("barrier_type") or "european").lower()
    autocall_enabled = bool(payload.get("autocall", product_type in ("autocall", "phoenix")))

    rate_supplied = payload.get("risk_free_rate") not in (None, "")
    risk_free_rate = num("risk_free_rate", DEFAULT_RATES.get(currency, 0.03))

    vol_supplied = payload.get("volatility") not in (None, "")
    if vol_supplied:
        volatility = num("volatility", FALLBACK_VOL)
        vol_known = True
    else:
        volatility, vol_known = _lookup(DEFAULT_VOLS, underlying, FALLBACK_VOL)

    div_supplied = payload.get("dividend_yield") not in (None, "")
    if div_supplied:
        dividend_yield = num("dividend_yield", FALLBACK_DIV)
        div_known = True
    else:
        dividend_yield, div_known = _lookup(DEFAULT_DIVS, underlying, FALLBACK_DIV)

    credit_spread = num("credit_spread", FALLBACK_CREDIT_SPREAD)
    # Потоки ноты — обязательства эмитента и дисконтируются по ЕГО кривой.
    # PayoffParams.issuer_rate_t() добавляет credit_spread только при заданном
    # zero_rate_fn; без issuer_rate спред молча терялся, и нота оценивалась так,
    # будто банк безрисковый — справедливая стоимость получалась завышенной.
    issuer_rate = risk_free_rate + credit_spread

    # Observation grid. Keep the total step count sane for an interactive call:
    # daily steps (252/yr) are ideal but blow up on long tenors, so cap the
    # per-period resolution while never dropping below weekly.
    n_observation_periods = max(int(round(periods_per_year * total_years)), 1)
    ideal = int(round(252 / periods_per_year))
    # Движок жёстко режет n_steps до MAX_STEPS=1500 (monte_carlo.py:136,220,461),
    # но dt приходит от нас — при обрезке смоделированный горизонт становился
    # 1500*dt вместо total_years, и всё длиннее ~5.95 года считалось как
    # шестилетнее. Уменьшаем шаги В ПЕРИОДЕ, а не общее число: тогда сетка
    # наблюдений остаётся согласованной с payoff-оценщиком, а срок — полным.
    steps_per_period = max(min(ideal, 4000 // n_observation_periods,
                               ENGINE_MAX_STEPS // n_observation_periods), 1)
    n_steps = n_observation_periods * steps_per_period
    dt = total_years / n_steps

    n_paths = int(num("n_paths", 20_000))
    n_paths = max(2_000, min(n_paths, 100_000))
    seed = int(num("seed", 20260826))  # fixed by default: same note -> same number

    params = PayoffParams(
        product_type=product_type,
        nominal=1.0,                     # normalised; absolute value applied after
        barrier_level=barrier_level,
        barrier_type=barrier_type,
        coupon_rate=coupon_rate,
        coupon_frequency=coupon_frequency,
        coupon_type=coupon_type,
        coupon_barrier=(num("coupon_barrier", barrier_level * 100) / 100.0
                        if payload.get("coupon_barrier") not in (None, "") else None),
        autocall_enabled=autocall_enabled,
        autocall_barrier=num("autocall_barrier", 100.0) / 100.0,
        autocall_frequency=coupon_frequency,
        lockout_periods=int(num("lockout_periods", 0)),
        capital_protection=capital_protection,
        participation_rate=num("participation_rate", 1.0),
        purchase_price=purchase_price,
        basket_type="single",
        n_observation_periods=n_observation_periods,
        periods_per_year=periods_per_year,
        risk_free_rate=risk_free_rate,
        issuer_rate=issuer_rate,
        total_years=total_years,
        credit_spread=credit_spread,
        steps_per_period=steps_per_period,
    )

    # ── Real engine: simulate, then evaluate the payoff ────────
    paths = simulate_paths(
        spot_prices=[1.0],               # work in performance space (S0 = 100%)
        volatilities=[volatility],
        correlation_matrix=np.array([[1.0]]),
        risk_free_rate=risk_free_rate,
        n_steps=n_steps,
        n_paths=n_paths,
        dt=dt,
        dividend_yields=[dividend_yield],
        seed=seed,
    )
    if paths.ndim == 2:                  # (n_paths, n_steps+1) -> add asset axis
        paths = paths.reshape(paths.shape[0], 1, paths.shape[1])

    result = evaluate_paths(paths, params)

    fair_value_pct = float(result.get("fair_value_pct", 0.0))
    purchase_pct = round(purchase_price * 100, 2)
    markup_pct = round(purchase_pct - fair_value_pct, 2)

    # ── Real engine: decompose the markup ──────────────────────
    margin = MarginDetector.analyze_from_params(
        product_type=product_type,
        total_markup_pct=markup_pct,
        n_underlyings=1,
        maturity_years=total_years,
        issuer_credit_spread=credit_spread,
        coupon_type=coupon_type,
        autocall_enabled=autocall_enabled,
        barrier_type=barrier_type,
        lockout_periods=int(num("lockout_periods", 0)),
        participation_rate=num("participation_rate", 1.0),
        nominal_rub=nominal,
    )

    warnings = list(margin.warnings)
    if not vol_known and not vol_supplied:
        warnings.append(
            f"Волатильность базового актива неизвестна — принята {volatility:.0%}. "
            "Уточните её: оценка чувствительна к этому параметру."
        )
    if not div_known and not div_supplied:
        warnings.append(
            f"Дивидендная доходность базового актива неизвестна — принята {dividend_yield:.1%}. "
            "Для индексных нот это заметно влияет на оценку."
        )
    if not rate_supplied:
        warnings.append(
            f"Безрисковая ставка принята {risk_free_rate:.2%} по валюте {currency}."
        )
    mc_warn = (result.get("mc_diagnostics") or {}).get("warnings") or []
    warnings.extend(mc_warn)

    return {
        "valuation": {
            "fair_value_pct": round(fair_value_pct, 2),
            "fair_value_abs": round(fair_value_pct / 100 * nominal, 2),
            "purchase_pct": purchase_pct,
            "std_error_pct": result.get("fv_std_error_pct"),
        },
        "bank_margin": {
            "total_pct": markup_pct,
            "total_abs": round(markup_pct / 100 * nominal, 2),
            **margin.to_dict(),
        },
        "probabilities": {
            "autocall": result.get("prob_autocall"),
            "barrier_hit": result.get("prob_barrier_hit"),
            "full_return": result.get("prob_full_return"),
            "loss": result.get("prob_loss_pct"),
        },
        "expected": {
            "return_pct_pa": result.get("expected_return_pct"),
            "expected_loss_pct": result.get("expected_loss_pct"),
        },
        "assumptions": {
            "volatility": round(volatility, 4),
            "volatility_source": "указана" if vol_supplied else ("справочник" if vol_known else "по умолчанию"),
            "dividend_yield": round(dividend_yield, 4),
            "dividend_source": "указана" if div_supplied else ("справочник" if div_known else "по умолчанию"),
            "risk_free_rate": round(risk_free_rate, 4),
            "rate_source": "указана" if rate_supplied else f"по умолчанию для {currency}",
            "credit_spread": round(credit_spread, 4),
            "issuer_rate": round(issuer_rate, 4),
            "maturity_years": round(total_years, 2),
            "observations": n_observation_periods,
            "coupon_frequency": coupon_frequency,
            "currency": currency,
        },
        "engine": {
            "source": "EvidenceInvest product_pricing (handoff 2026-08-25)",
            "modules": ["monte_carlo", "payoff_evaluator", "margin_detector"],
            "n_paths": result.get("n_paths", n_paths),
            "n_steps": n_steps,                       # именно столько и симулируется
            "steps_per_period": steps_per_period,
            "horizon_years": round(n_steps * dt, 4),  # обязан совпасть с maturity_years
            "seed": seed,
        },
        "warnings": warnings,
    }


def solve_fair_coupon(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Find the coupon at which the note is worth exactly what it costs.

    Fair value is linear in the coupon rate: the coupon leg scales with it while
    the principal leg does not. Two priced points therefore pin the line exactly,
    and a third evaluation verifies the solution rather than trusting the algebra.

    Returns the fair coupon and how far the offered coupon falls short of it.
    """
    def at(coupon: float) -> float:
        probe = dict(payload)
        probe["coupon"] = coupon
        probe.setdefault("n_paths", 20_000)
        return price_note(probe)["valuation"]["fair_value_pct"]

    target = float(payload.get("purchase_price", 100.0) or 100.0)
    lo_c, hi_c = 0.0, 10.0
    lo_v, hi_v = at(lo_c), at(hi_c)

    slope = (hi_v - lo_v) / (hi_c - lo_c)
    if abs(slope) < 1e-9:                     # degenerate: coupon does not move value
        return {"fair_coupon_pct": None, "reason": "Купон не влияет на стоимость этой структуры"}

    fair = (target - lo_v) / slope
    fair = max(0.0, min(fair, 100.0))

    check = at(fair)                          # verify, don't assume
    offered = float(payload.get("coupon", 0.0) or 0.0)

    return {
        "fair_coupon_pct": round(fair, 2),
        "offered_coupon_pct": round(offered, 2),
        "shortfall_pp": round(fair - offered, 2),
        "value_at_fair_coupon_pct": round(check, 2),
        "residual_pp": round(check - target, 2),   # how exactly the solve landed
    }
