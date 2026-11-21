const products = [
  ['IM', '中证 1000 股指期货', 'CSI 1000 Index Futures', 200, 'zz1000'],
  ['IC', '中证 500 股指期货', 'CSI 500 Index Futures', 200, 'zz500'],
  ['IF', '沪深 300 股指期货', 'CSI 300 Index Futures', 300, 'hs300'],
  ['IH', '上证 50 股指期货', 'SSE 50 Index Futures', 300, 'sz50'],
];
export const futureCatalog = products.map(([symbol,nameZh,nameEn,multiplier,page])=>({
  symbol,nameZh,nameEn,multiplier,tick:0.2,region:'cn',type:'future',market:'future',currency:'CNY',
  timeZone:'Asia/Shanghai',marginRate:null,specUrl:'http://www.cffex.com.cn/'+page+'/'
}));
