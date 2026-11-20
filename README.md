# 浪线 WaveLab

中文多市场 K 线训练终端。在图表上查看已揭晓的行情，决定是否下单，再让时间前进一根 K 线。[打开训练站](https://ethan-chunqi.github.io/kline-replay-lab/)

## 开始练习

选择市场，输入模拟数量，点击「模拟买入」或「模拟卖出」。点「下一根」或按方向右键揭晓下一根基础 K 线。播放键可自动推进，速度支持 0.5× 至 8×。默认账户从 100,000 本币起步。切换市场会保存并恢复该市场的训练。

| 功能 | 内容 |
| --- | --- |
| 市场 | 中证 1000、中证 500、纳斯达克 100、沪深 300、标普 500、恒生指数 |
| 行情回放 | 日线、15 分钟线、小时线训练，随机或指定起点。可见数据可聚合为周线和月线 |
| 技术分析 | 蜡烛图、收盘折线、成交量、MA5 / MA20 / MA60、布林带、RSI、MACD、十字光标、趋势线和水平线 |
| 模拟交易 | 市价、限价、停止、停止限价，开多、做空、平仓、撤单、仓位止盈止损，可配置手续费和滑点 |
| 交易复盘 | 持仓、委托、成交价和费用、净值及标的基准曲线、超额收益、胜率、回撤、重练同一段行情、多空表现、交易笔记、成交 CSV 导出和训练存档 |

## 行情来源与交易规则

内置行情由可复现的伪随机模型生成，指数名称用于选择练习场景及币种。训练日历跳过周末。分时练习使用各市场交易时段。成交量表示合成活跃度。复现一段实际历史时，在「新建训练 → 基础行情」选择「导入历史 CSV」并选择对应市场。

导入支持中英文表头、带引号的 CSV、TSV 和常见日期格式。每个文件 30 至 20,000 根 K 线，最多 8 MB。日期、开盘、最高、最低、收盘必填，成交量可选。下方片段仅演示表头与数值格式。

```csv
date,open,high,low,close,volume
2024-01-02,100,105,98,103,28000
2024-01-03,103,107,101,106,31500
```

每个指数点按 1 本币模拟计价。市价委托在已揭晓收盘价上计入滑点。其余三类委托最早从下一根基础 K 线开始撮合。每根按「开盘 → 离开盘较近的极值 → 另一个极值 → 收盘」确定先后，等距时先走低点。停止限价单触发后继续按照限价等待。每笔成交计收手续费。卖空需要全额担保，账户权益降至空仓市值的 50% 时触发强平。跳空和每根 K 线内部的实际成交路径可能与模拟有差异。指数本身与跟踪 ETF、股指期货有不同的成交单位和交易规则。

## 运行与存储

源码为原生 ES modules，图表依赖已随仓库提供。GitHub Pages 从 `main` 分支根目录直接发布。本地可在项目目录运行：

```sh
python3 -m http.server 8000
```

在浏览器访问 [localhost:8000](http://localhost:8000)。训练与导入的行情通过 IndexedDB 在当前浏览器保存，清除站点数据会删除本机记录。导入文件和交易记录只在本机处理。

## 参考与授权

- 图表使用 [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts)。随附 [Apache-2.0 许可证](vendor/lightweight-charts/LICENSE) 和 [版权声明](vendor/lightweight-charts/NOTICE)。
- 回放和模拟委托参考 [TradingView Replay Trading](https://www.tradingview.com/support/solutions/43000691889-learn-to-trade-on-historical-data/) 与 [GoCharting Bar Replay](https://gocharting.com/docs/backtest/barreplay)。
- 复盘笔记参考 [FX Replay Backtesting Journal](https://support.fxreplay.com/articles/tracking-your-trades-with-the-journal-feature)。
