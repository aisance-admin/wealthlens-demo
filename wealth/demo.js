/* Флоу велса · демо-отчёт на вымышленном портфеле.
   Холодный посетитель не станет загружать выписки, не увидев результата. Демо собирается
   тем же импортом таблиц, что и настоящие файлы, поэтому показывает ровно то, что получит
   клиент: живые цены, сроки, выводы. Данные вымышленные; в хранилище браузера не пишутся. */
(function(){
const WL = window.WL;
const pad = n => String(n).padStart(2, "0");

// Ближайшая месячная экспирация (третья пятница) не раньше чем через три недели:
// короткий пут должен попадать в «Сроки», а контракт — реально торговаться.
function monthlyExpiry(){
  const d = new Date(); d.setDate(d.getDate() + 21);
  for(let k = 0; k < 3; k++){
    const first = new Date(d.getFullYear(), d.getMonth() + k, 1);
    const fri = new Date(first); fri.setDate(1 + ((5 - first.getDay() + 7) % 7) + 14);
    if(fri >= d) return fri;
  }
  return d;
}

WL.demoDocs = function(lang){
  const x = monthlyExpiry(), yy = String(x.getFullYear()).slice(2), mm = pad(x.getMonth() + 1), dd = pad(x.getDate());
  const occ = `AAPL${yy}${mm}${dd}P00300000`;
  const cash = lang === "en" ? "Cash" : "Денежные средства";
  const rows = [
    "Broker;Name;Ticker;Type;Quantity;Purchase price;Purchase date;Commission;Current price;Market value;Currency",
    "Interactive Brokers;Apple Inc;AAPL;Stock;400;172,30;12.03.2023;1,00;;;USD",
    "Interactive Brokers;Microsoft Corp;MSFT;Stock;250;310,50;05.06.2023;1,00;;;USD",
    "Interactive Brokers;NVIDIA Corp;NVDA;Stock;2600;46,20;18.01.2023;1,00;;;USD",
    "Interactive Brokers;iShares Core S&P 500 ETF;IVV;Fund;300;420,10;02.02.2024;1,00;;;USD",
    "Interactive Brokers;SPDR Gold Shares;GLD;Fund;400;185,40;11.10.2023;1,00;;;USD",
    `Interactive Brokers;${cash};USD;Cash;;;;;;185000,00;USD`,
    "UBS;Nestle SA;NESN.SIX;Stock;1200;104,20;15.05.2022;25,00;88,10;105720,00;CHF",
    "UBS;Roche Holding;ROG.SIX;Stock;300;285,00;20.09.2022;25,00;262,40;78720,00;CHF",
    "UBS;US Treasury 4.25% 2031;;Bond;500000;0,9860;14.06.2024;;0,9910;495500,00;USD",
    `UBS;${cash};CHF;Cash;;;;;;64000,00;CHF`,
    "Charles Schwab;Alphabet Inc;GOOGL;Stock;500;128,40;03.04.2023;0,00;;;USD",
    "Charles Schwab;Visa Inc;V;Stock;350;231,70;22.08.2023;0,00;;;USD",
    `Charles Schwab;${cash};USD;Cash;;;;;;40000,00;USD`,
    `Charles Schwab;${lang === "en" ? "AAPL 300 put" : "AAPL пут 300"};${occ};Option;-5;4,10;${new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10)};3,25;;;USD`,
    "Saxo Bank;ASML Holding;ASML.AS;Stock;80;610,00;09.11.2023;12,00;598,00;47840,00;EUR",
    `Saxo Bank;${cash};EUR;Cash;;;;;;42000,00;EUR`];
  const csv = rows.join("\n");
  const file = {name: lang === "en" ? "demo-portfolio.csv" : "демо-портфель.csv"};
  const all = [];
  // Каждая площадка — отдельный документ, как если бы клиент принёс четыре выгрузки.
  const header = rows[0];
  const brokers = [...new Set(rows.slice(1).map(r => r.split(";")[0]))];
  brokers.forEach(b => {
    const body = [header, ...rows.slice(1).filter(r => r.startsWith(b + ";"))];
    const matrix = body.map(r => r.split(";"));
    const head = WL.sheetFind(matrix);
    const doc = WL.sheetDoc(matrix, head, {name: `${b} · ${file.name}`});
    doc.broker = b; doc.from = "demo";
    doc.note = lang === "en" ? "demo portfolio, fictional data" : "демо-портфель, данные вымышленные";
    all.push(doc);
  });
  return all;
};
})();
