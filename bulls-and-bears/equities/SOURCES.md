# 证券行情与交易时间

档案于 2026 年 11 月 22 日核对，最近一场交易为当地 11 月 20 日。盘中报价和每日归档由仓库的行情工作流更新。图表横轴使用交易所本地交易日和历史时间戳。

| 市场 | 来源与价格口径 |
| --- | --- |
| 美国 | [Yahoo Finance 图表数据（以 AAPL 为例）](https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=15m&range=5d)。使用常规交易时段、拆股调整价格，个股成交量单位为股。15 分钟数据向 30 分钟汇总。 |
| 中国内地 | [腾讯证券分钟线（以上证指数为例）](https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh000001,m1,,640)、[腾讯证券日线](https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,,,640,qfq)与[新浪财经 15 分钟线](https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sh000001&scale=15&ma=no&datalen=6000)。个股日线采用腾讯前复权，分时采用实际交易价格。 |
| 韩国 | [Naver Pay Securities KRX 1 分钟行情（三星电子）](https://api.stock.naver.com/chart/domestic/item/005930/minute?wrapper=true)、[Naver KOSPI 200 历史日线](https://api.stock.naver.com/chart/domestic/index/KPI200/day?startDateTime=200001010000&endDateTime=202611202359&wrapper=true)、[Yahoo Finance 首尔市场历史（日线示例）](https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?interval=1d&range=1mo)。韩国指数日线来自 Naver，个股与 ETF 的日线来自 Yahoo。近期 1 分钟和普通行情页的分时来自 Naver，年内较长的 15 分钟、30 分钟及小时线来自 Yahoo。 |
| 韩国 AI 股票总市值 | 采用 [Naver KRX 市值行情](https://polling.finance.naver.com/api/realtime/domestic/stock/005930,000660) 的整韩元总市值字段 `marketValueFullRaw`，同时保存报价提供方的时间戳。八只代表性股票涵盖芯片与存储、服务器配套、算力服务、封装测试及半导体设备。 |

韩国常规交易时间采用首尔时间 09:00 至 15:30。2026 年首个交易日延至 10:00 开市，11 月 19 日高考日调整为 10:00 至 16:30。周末、公布的休市日和延长交易时段单独处理。[韩国交易所交易指南](https://global.krx.co.kr/contents/GLB/01/0109/0109000000/guide_to_trading_in_the_korean_stock_market.pdf) · [韩国券商 11 月 19 日交易时间公告](https://bank.myasset.com/myasset/customer/notice/CU_0201000_P2.cmd?SEQ=202611131405580000000004&gubun=norNotice)

## 可查历史

截至本次核对，A 股 15 分钟、30 分钟、小时和日线可追溯至本年首个交易日。三个市场的日线均可追溯至本年首个交易日。美国、韩国的小时记录可追溯至 1 月，个别时段缺失，展示时保留部分覆盖标记。跨周期汇总使用已有的真实 OHLCV。年度档案中的 1 分钟数据在美国自 10 月 23 日、中国内地自 10 月 22 日、韩国自 11 月 13 日开始。美国、韩国更早的 15 分钟记录受到公开源保留窗口限制。每个图表按标的和周期显示自身可查起点，档案此后按交易日累积。

美国与韩国长区间小时线仅绘制供应商确实发布的常规时段记录，空缺保持空缺。韩国近期 Naver 数据还会出现单列的收盘集合竞价，按官方收盘价处理；年度 Yahoo 数据源有时会在 15:00 行附上晚于该刻的收盘值，归档排除超出该源可核实时间范围的记录。
