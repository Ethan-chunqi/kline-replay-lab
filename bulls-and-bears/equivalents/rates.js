// Historical comparison rates (units of quote currency per USD).
export const fxAsOf='2026-11-20';
export const fxSources={
  CNY:'https://hzf.mofcom.gov.cn/article/zyfw/jrfw/jrfwywzn/jrfwwh/hlfxglzy/202611/9514.html',
  KRW:'https://www.yna.co.kr/view/AKR20261120127500002',
};
const rates={USD:1,USDT:1,CNY:6.7131,KRW:1336.20};
export function quotePerDollar(currency) {return rates[currency]??NaN;}
