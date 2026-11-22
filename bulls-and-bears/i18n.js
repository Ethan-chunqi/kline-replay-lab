// Dictionaries use the language order declared below. Text keys are also accepted
// for progressively translating the static HTML before market data has arrived.
export const languages = Object.freeze({ zh: '简体中文', en: 'English', ja: '日本語', ru: 'Русский', ko: '한국어' });
const locales = { zh: 'zh-CN', en: 'en-GB', ja: 'ja-JP', ru: 'ru-RU', ko: 'ko-KR' };
const indices = Object.fromEntries(Object.keys(languages).map((lang, i) => [lang, i]));

export function localeFor(lang) {
  return locales[lang] || locales.zh;
}

const messages = {
  brand: ['刘鲨鱼', 'LiuShaYu', 'LiuShaYu', 'LiuShaYu', 'LiuShaYu'],
  home: ['刘鲨鱼首页', 'LiuShaYu home', 'LiuShaYu ホーム', 'Главная LiuShaYu', 'LiuShaYu 홈'],
  skip: ['跳至行情', 'Skip to markets', '相場へ移動', 'Перейти к котировкам', '시세로 이동'],
  nav: ['主导航', 'Main navigation', 'メインナビゲーション', 'Основная навигация', '주 메뉴'],
  overview: ['行情总览', 'Markets', '相場一覧', 'Обзор рынка', '시장 개요'],
  navCalc: ['收益计算', 'P&L calculator', '損益計算', 'Расчёт прибыли', '손익 계산'],
  instruments: ['合约市场', 'Perpetuals', '無期限先物', 'Бессрочные фьючерсы', '무기한 선물'],
  selectContract: ['选择合约币种', 'Choose a contract', '銘柄を選択', 'Выбрать контракт', '계약 종목 선택'],
  selectMarket: ['选择市场', 'Select market', '市場を選択', 'Выбрать рынок', '시장 선택'],
  selectAsset: ['选择标的', 'Choose an instrument', '銘柄を選択', 'Выбрать инструмент', '종목 선택'],
  crypto: ['加密货币', 'Crypto', '暗号資産', 'Крипто', '암호화폐'],
  usStocks: ['美股', 'US stocks', '米国株', 'Акции США', '미국 주식'],
  cnStocks: ['A股', 'China A-shares', '中国A株', 'Акции Китая (A)', '중국 A주'],
  stocks: ['股票', 'Equities', '株式', 'Акции', '주식'],
  perpetual: ['永续', 'Perpetual', '無期限', 'Бессрочный', '무기한'],
  usMarket: ['美国股市', 'US market', '米国市場', 'Рынок США', '미국 시장'],
  cnMarket: ['中国 A 股', 'Chinese A-shares', '中国A株市場', 'Китайские акции A', '중국 A주 시장'],
  symbolSearch: ['搜索代码或名称', 'Search symbol or name', 'コード・銘柄名で検索', 'Поиск по тикеру или названию', '코드 또는 종목명 검색'],
  tradingSession: ['交易时段', 'Trading session', '取引時間帯', 'Торговая сессия', '거래 시간'],
  regular: ['盘中', 'Regular session', '取引中', 'Основная сессия', '정규장'],
  premarket: ['盘前', 'Pre-market', 'プレマーケット', 'Премаркет', '프리마켓'],
  afterhours: ['盘后', 'After-hours', '時間外取引', 'Постмаркет', '애프터마켓'],
  overnight: ['夜盘', 'Overnight', '夜間取引', 'Ночная сессия', '야간장'],
  recess: ['午间休市', 'Lunch break', '昼休み', 'Дневной перерыв', '점심 휴장'],
  closed: ['休市', 'Market closed', '休場', 'Рынок закрыт', '휴장'],
  marketOpen: ['开市', 'Market open', '市場オープン', 'Рынок открыт', '개장'],
  lastSession: ['最近交易日', 'Latest trading day', '直近の取引日', 'Последний торговый день', '최근 거래일'],
  delayed: ['延时行情', 'Delayed quotes', '遅延相場', 'Котировки с задержкой', '지연 시세'],
  sessionChange: ['当日涨跌幅', 'Session change', '当日騰落率', 'Изменение за сессию', '당일 등락률'],
  sessionHigh: ['当日最高', 'Session high', '当日高値', 'Максимум сессии', '당일 고가'],
  sessionLow: ['当日最低', 'Session low', '当日安値', 'Минимум сессии', '당일 저가'],
  prevClose: ['昨收', 'Previous close', '前日終値', 'Пред. закрытие', '전일 종가'],
  lastPrice: ['最新价', 'Last price', '現在値', 'Последняя цена', '현재가'],
  change24: ['24 小时涨跌幅', '24h change', '24時間騰落率', 'Изменение за 24 ч', '24시간 등락률'],
  high24: ['24 小时最高', '24h high', '24時間高値', 'Максимум за 24 ч', '24시간 고가'],
  low24: ['24 小时最低', '24h low', '24時間安値', 'Минимум за 24 ч', '24시간 저가'],
  trend24: ['24 小时价格走势', '24h price trend', '24時間の値動き', 'Динамика за 24 ч', '24시간 가격 추이'],
  sparkAria: ['所选合约最近 24 小时价格走势', 'Selected contract’s 24-hour price chart', '選択した銘柄の24時間価格推移', 'График цены выбранного контракта за 24 часа', '선택한 계약의 최근 24시간 가격 추이'],
  dayTrend: ['当日走势', 'Intraday trend', '当日の値動き', 'Внутридневная динамика', '당일 가격 추이'],
  chart: ['K 线走势', 'Candlestick chart', 'ローソク足', 'Свечной график', '캔들 차트'],
  chartRange: ['K 线显示范围', 'Chart range', 'チャートの表示期間', 'Диапазон графика', '차트 표시 범위'],
  interval: ['15 分钟', '15 min', '15分足', '15 мин', '15분봉'],
  hours24: ['24 小时', '24h', '24時間', '24 ч', '24시간'],
  hours48: ['48 小时', '48h', '48時間', '48 ч', '48시간'],
  days7: ['7 天', '7d', '7日', '7 дн.', '7일'],
  ohlc: ['所选 K 线的开高低收', 'Selected candle open, high, low and close', '選択した足の始値・高値・安値・終値', 'Цены открытия, максимума, минимума и закрытия свечи', '선택한 캔들의 시가·고가·저가·종가'],
  open: ['开', 'O', '始', 'Откр.', '시'],
  high: ['高', 'H', '高', 'Макс.', '고'],
  low: ['低', 'L', '安', 'Мин.', '저'],
  close: ['收', 'C', '終', 'Закр.', '종'],
  volume: ['成交量', 'Volume', '出来高', 'Объём', '거래량'],
  shares: ['股', 'shares', '株', 'акций', '주'],
  reset: ['重置视图', 'Reset view', '表示をリセット', 'Сбросить вид', '차트 초기화'],
  extremes: ['周期高低点', 'Cycle extremes', 'サイクルの高値・安値', 'Экстремумы цикла', '사이클 고점·저점'],
  drawdown: ['历史高点回撤', 'Drawdown from ATH', '最高値からの下落率', 'Просадка от максимума', '역대 고점 대비 하락률'],
  rebound: ['周期低点反弹', 'Rebound from cycle low', '底値からの反発率', 'Отскок от минимума', '사이클 저점 대비 반등률'],
  highPrice: ['合约历史最高价', 'Contract all-time high', '上場来高値', 'Максимум контракта', '계약 역대 최고가'],
  stockHigh: ['历史最高价', 'All-time high', '上場来高値', 'Исторический максимум', '역대 최고가'],
  lowPrice: ['见顶后最低价', 'Lowest price since ATH', '最高値更新後の安値', 'Минимум после пика', '역대 고점 이후 최저가'],
  jumpHigh: ['跳到高点', 'Show peak', '高値を表示', 'К максимуму', '고점 보기'],
  jumpLow: ['跳到低点', 'Show trough', '安値を表示', 'К минимуму', '저점 보기'],
  backLive: ['返回实时', 'Back to live', '現在に戻る', 'К текущим данным', '실시간으로'],
  historyView: ['历史视图', 'Historical chart', '過去のチャート', 'Исторический график', '과거 차트'],
  calculator: ['多空盈亏计算', 'Long / short P&L', 'ロング・ショート損益', 'Расчёт прибыли и убытка', '롱·숏 손익 계산'],
  usdtSettled: ['USDT 本位', 'USDT margined', 'USDT建て', 'Расчёт в USDT', 'USDT 기준'],
  capital: ['模拟本金', 'Capital', '元手', 'Начальный капитал', '모의 원금'],
  leverage: ['杠杆倍数', 'Leverage', 'レバレッジ', 'Плечо', '레버리지'],
  basis: ['开仓基准', 'Entry basis', '建値の基準', 'База для входа', '진입가 기준'],
  extremesBasis: ['历史高点做空 / 周期低点做多', 'Short at ATH / long at cycle low', '最高値でショート／底値でロング', 'Шорт от пика / лонг от минимума', '역대 고점 숏 / 사이클 저점 롱'],
  customBasis: ['自定义多空开仓价', 'Custom entry for both sides', '共通の建値を指定', 'Задать цену для обеих позиций', '롱·숏 진입가 직접 입력'],
  customEntry: ['自定义开仓价', 'Custom entry price', '指定した建値', 'Своя цена входа', '사용자 지정 진입가'],
  inputPrice: ['输入价格', 'Enter price', '価格を入力', 'Введите цену', '가격 입력'],
  short: ['做空', 'Short', 'ショート', 'Шорт', '숏'],
  long: ['做多', 'Long', 'ロング', 'Лонг', '롱'],
  pnl: ['模拟盈亏', 'Simulated P&L', '想定損益', 'Расчётный P&L', '모의 손익'],
  entryPrice: ['开仓价', 'Entry price', '建値', 'Цена входа', '진입가'],
  roi: ['本金收益率', 'Return on capital', '元手に対する損益率', 'Доходность капитала', '원금 수익률'],
  calcNote: ['浮动盈亏按最新成交价计算，未计手续费、资金费、滑点及强平。', 'Unrealised P&L uses the latest trade price. Excludes fees, funding, slippage and liquidation.', '現在値で含み損益を計算。手数料、資金調達料、スリッページ、強制清算は計算対象外です。', 'Нереализованный результат по последней цене. Без учёта комиссий, финансирования, проскальзывания и ликвидации.', '현재가 기준 미실현 손익이며 수수료, 펀딩비, 슬리피지, 강제 청산은 반영하지 않습니다.'],
  footerZone: ['北京时间 UTC+8', 'Beijing time UTC+8', '北京時間 UTC+8', 'Пекинское время UTC+8', '베이징 시간 UTC+8'],
  chartCredits: ['图表版权', 'Chart credits', 'チャートのクレジット', 'Авторы графика', '차트 저작권'],
  xProfile: ['X 主页', 'X profile', 'Xプロフィール', 'Профиль в X', 'X 프로필'],
  followX: ['关注 X', 'Follow on X', 'Xでフォロー', 'Подписаться в X', 'X에서 팔로우'],
  xAria: ['在新标签页打开刘鲨鱼的 X 主页，@LiuShaYu2026', 'Open LiuShaYu’s X profile in a new tab, @LiuShaYu2026', 'LiuShaYuのXプロフィール（@LiuShaYu2026）を新しいタブで開く', 'Открыть профиль LiuShaYu в X в новой вкладке, @LiuShaYu2026', '새 탭에서 LiuShaYu의 X 프로필 @LiuShaYu2026 열기'],
  signatureAria: ['刘鲨鱼的个人签名，前往 X 主页 @LiuShaYu2026', 'Visit LiuShaYu on X, @LiuShaYu2026', 'LiuShaYuのXプロフィール @LiuShaYu2026 へ', 'Профиль LiuShaYu в X, @LiuShaYu2026', 'LiuShaYu의 X 프로필 @LiuShaYu2026 방문'],
  signature: ['等一个机会，迎来自己的爆发', 'Waiting for the chance to make my move', '自分が飛躍するチャンスを待つ', 'Жду своего шанса на прорыв', '나만의 도약을 위한 기회를 기다리며'],
  registerBinance: ['注册币安', 'Join Binance', 'Binanceに登録', 'Регистрация на Binance', '바이낸스 가입'],
  referral: ['币安返佣注册', 'Binance referral signup', '紹介リンクからBinanceに登録', 'Регистрация на Binance по приглашению', '바이낸스 추천 가입'],
  language: ['语言', 'Language', '言語', 'Язык', '언어'],
  theme: ['主题', 'Theme', 'テーマ', 'Тема', '테마'],
  dark: ['深色', 'Dark', 'ダーク', 'Тёмная', '다크'],
  light: ['浅色', 'Light', 'ライト', 'Светлая', '라이트'],
  darkMode: ['切换深色模式', 'Use dark mode', 'ダークモードに切り替え', 'Включить тёмную тему', '다크 모드로 전환'],
  lightMode: ['切换浅色模式', 'Use light mode', 'ライトモードに切り替え', 'Включить светлую тему', '라이트 모드로 전환'],
  pageTitle: ['刘鲨鱼 · {symbol} 行情', 'LiuShaYu · {symbol} market', 'LiuShaYu · {symbol} 相場', 'LiuShaYu · {symbol} — котировки', 'LiuShaYu · {symbol} 시세'],
  statusLoading: ['连接中', 'Connecting', '接続中', 'Подключение', '연결 중'],
  statusLive: ['实时行情', 'Live', 'リアルタイム', 'Онлайн', '실시간'],
  statusStale: ['历史快照', 'Saved quote', '保存済み相場', 'Сохранённая котировка', '저장된 시세'],
  statusOffline: ['等待重连', 'Reconnecting', '再接続中', 'Переподключение', '재연결 중'],
  artCredit: ['图片来源','Image credits','画像出典','Источники изображений','이미지 출처'],
  artUsCredit: ['马斯克摄影：Debbie Rowe，The Royal Society。','Elon Musk photographed by Debbie Rowe, The Royal Society.','イーロン・マスクの写真：Debbie Rowe、英国王立協会。','Фото Илона Маска: Debbie Rowe, The Royal Society.','일론 머스크 사진: Debbie Rowe, The Royal Society.'],
  artCnCredit: ['背景为 DeepSeek 创始人梁文锋的 AI 辅助原创肖像插画。','Background illustration of DeepSeek founder Liang Wenfeng, created with AI assistance.','背景はAIを使用して描いたDeepSeek創業者、梁文鋒の肖像イラストです。','На фоне — иллюстрация с основателем DeepSeek Лян Вэньфэном, созданная с помощью ИИ.','배경은 AI의 도움으로 제작한 딥시크 창업자 량원펑의 초상 일러스트입니다.'],
  paperTitle: ['模拟开单','Paper trading','模擬取引','Демо-торговля','모의 거래'],
  paperTab: ['仅当前标签页 · 刷新后清空','This tab only · resets on reload','このタブのみ・再読み込みでリセット','Только эта вкладка · сброс при обновлении','현재 탭 전용 · 새로고침 시 초기화'],
  paperCapital: ['每笔本金（USDT）','Capital per trade (USDT)','1回の元本（USDT）','Сумма сделки (USDT)','거래당 원금 (USDT)'],
  paperLeverage: ['杠杆倍数','Leverage (×)','レバレッジ（倍）','Плечо (×)','레버리지 (배)'],
  paperDirection: ['方向','Direction','方向','Направление','방향'],
  paperLong: ['做多','Long','ロング','Лонг','롱'],
  paperShort: ['做空','Short','ショート','Шорт','숏'],
  paperOpen: ['现在开单','Open position','現在値で建てる','Открыть позицию','지금 진입'],
  paperClose: ['平仓','Close position','決済','Закрыть позицию','청산'],
  paperQuantity: ['持仓数量','Quantity','数量','Количество','보유 수량'],
  paperEntry: ['开仓价','Entry price','建値','Цена входа','진입가'],
  paperCurrent: ['盈亏计算价','P&L calculation price','直近の評価価格','Цена для расчёта','최근 평가가'],
  paperExit: ['平仓价','Exit price','決済価格','Цена закрытия','청산가'],
  paperRealized: ['已实现盈亏','Realized P&L','確定損益','Результат сделки','실현 손익'],
  paperFloating: ['浮动盈亏','Unrealized P&L','含み損益','Плавающий результат','미실현 손익'],
  paperLots: ['手','lots','枚','лотов','계약'],
  paperUnits: ['份','units','口','ед.','단위'],
  paperNoQuote: ['等待可成交的新报价','Waiting for a fresh eligible quote','約定可能な最新価格を待機中','Ждём свежую цену для сделки','체결 가능한 최신 호가 대기'],
  paperClosed: ['休市，暂停开平仓','Market closed · orders paused','休場中・売買停止','Рынок закрыт · сделки недоступны','휴장 중 · 주문 중지'],
  paperOneLot: ['不足 1 手，请调整本金或杠杆','Less than one contract. Adjust capital or leverage.','1枚未満です。元本または倍率を調整してください。','Не хватает на один контракт. Измените сумму или плечо.','1계약 미만입니다. 원금이나 레버리지를 조정하세요.'],
  paperFx: ['参考汇率','Reference FX','参考為替','Справочный курс','참고 환율'],
  paperInputs: ['请输入正本金和 1–125 倍整数杠杆','Enter a positive amount and leverage from 1× to 125× in whole steps','正の元本と1～125の整数倍率を入力してください','Введите положительную сумму и целое плечо от 1 до 125','양수 원금과 1~125배 정수 레버리지를 입력하세요'],
  paperLiveQuote: ['按实时成交价模拟','Simulated at the live trade price','リアルタイム約定値で計算','Расчёт по текущей цене сделки','실시간 체결가 기준 모의 거래'],
  paperDelayedQuote: ['按盘中延迟报价模拟','Simulated at the delayed session quote','取引時間中の遅延価格で計算','Расчёт по задержанной цене сессии','장중 지연 시세 기준 모의 거래'],
  paperIndex: ['指数点位模拟份额','Simulated index units','指数連動の仮想口数','Условные единицы индекса','지수 포인트 기반 모의 단위'],
  paperSelectSame: ['请选择该标的及同一合约后平仓','Select this instrument and its original contract to close','決済には元の銘柄と限月を選択してください','Для закрытия выберите исходный инструмент и контракт','청산하려면 원래 종목과 계약을 선택하세요'],
  paperAlreadyClosed: ['这笔仓位已平仓','This position is already closed','この取引は決済済みです','Эта позиция уже закрыта','이미 청산한 포지션입니다'],
  paperFilledOpen: ['模拟开仓已成交','Simulated opening order filled','模擬新規注文が約定しました','Демо-позиция открыта','모의 진입 체결'],
  paperFilledClose: ['模拟平仓已成交','Simulated closing order filled','模擬決済が約定しました','Демо-позиция закрыта','모의 청산 체결'],
  paperQuoteAt: ['报价时间','Quote time','評価時刻','Время котировки','평가 시각'],
  paperClosedAt: ['平仓时间','Closed at','決済時刻','Время закрытия','청산 시각'],
  cnAiGroup: ['A 股 AI 产业链 · 总市值从高到低','China A-share AI supply chain · by market cap','中国A株のAI関連銘柄・時価総額順','ИИ в Китае · акции A по капитализации','중국 A주 AI 공급망 · 시가총액순'],
  marketCap: ['总市值','Market cap','時価総額','Капитализация','시가총액'],
  deyeSector: ['逆变器与储能配套','Inverters and energy storage','インバーター・蓄電関連','Инверторы и системы накопления энергии','인버터 및 에너지 저장 장비'],
  stockAdjusted: ['日线 · 前复权','Daily · forward-adjusted','日足・権利調整後','Дневные · с поправкой на корп. действия','일봉 · 전복권 조정'],
  stockUnadjusted: ['分时 · 不复权','Intraday · unadjusted','分足・権利調整前','Внутри дня · без корректировки','분봉 · 무수정'],
  solLowLabel: ['起算以来低点', 'Low since tracking began', '追跡開始以来の安値', 'Минимум с начала отслеживания', '추적 시작 이후 최저가'],
  solRebound: ['起算低点反弹', 'Rebound from tracked low', '追跡安値からの反発率', 'Отскок от минимума периода', '추적 저점 대비 반등률'],
  solLowSince: ['2026-11-22 以来最低价', 'Lowest since 22 Nov 2026', '2026年11月22日以降の安値', 'Минимум с 22.11.2026', '2026년 11월 22일 이후 최저가'],
  solLowStartZone: ['低点按北京时间起算', 'Low tracked in UTC+8', '安値の起点は北京時間', 'Отсчёт минимума по UTC+8', '최저가 기준 시각 UTC+8'],
  solCycleTip: ['高点取该永续合约全部历史。低点从北京时间 2026-11-22 00:00 起持续跟踪，每次出现更低价格时更新。', 'The high spans the full contract history. The low tracks new lows from 22 Nov 2026, 00:00 UTC+8 onward.', '高値は当取引所の上場来。安値は北京時間2026年11月22日0時以降に記録した最安値です。', 'Максимум за всю историю контракта. Минимум отслеживается с 00:00 22.11.2026 по UTC+8.', '고점은 해당 계약의 전체 이력, 저점은 2026년 11월 22일 00:00 (UTC+8) 이후의 최저가입니다.'],
  cycleFull: ['合约全历史', 'Full contract history', '上場来', 'Вся история контракта', '전체 계약 이력'],
  cycleStockFull: ['上市以来', 'Since listing', '上場来', 'С начала торгов', '상장 이후'],
  cycleUnavailable: ['历史待核验', 'History unverified', '履歴未確認', 'История не подтверждена', '이력 확인 필요'],
  cycleLoading: ['核对历史中', 'Checking history', '履歴を照合中', 'Проверяем историю', '이력 확인 중'],
  cycleTip: ['最高价取该交易所永续合约全部成交历史，最低价取该高点之后。', 'High across this exchange’s contract history, then the lowest trade after that high.', '当取引所の無期限先物の全約定から最高値と、その後の最安値を集計しています。', 'Максимум за всю историю контракта на этой бирже и минимум после этого максимума.', '해당 거래소 무기한 선물의 전체 체결 이력에서 최고가와 그 이후 최저가를 구합니다.'],
  precisionTrade: ['北京时间，按成交时间显示', 'Beijing time, based on the trade timestamp', '北京時間、約定時刻を表示', 'Пекинское время, по времени сделки', '베이징 시간, 체결 시각 기준'],
  precisionBar: ['北京时间，精确到所在的 {minutes} 分钟 K 线', 'Beijing time, to the {minutes}-minute candle', '北京時間、該当する{minutes}分足の開始時刻', 'Пекинское время, с точностью до свечи {minutes} мин', '베이징 시간, 해당 {minutes}분봉 시작 시각'],
  precisionDay: ['按交易日显示', 'Trading-day precision', '取引日単位で表示', 'С точностью до торгового дня', '거래일 단위로 표시'],
  loadingChart: ['正在获取 K 线…', 'Loading candles…', 'ローソク足を読み込み中…', 'Загрузка свечей…', '캔들 불러오는 중…'],
  chartOffline: ['行情暂不可用，正在重连…', 'Quotes unavailable. Reconnecting…', '相場を取得できません。再接続中…', 'Котировки недоступны. Переподключение…', '시세를 불러올 수 없습니다. 재연결 중…'],
  noticeStale: ['正在重连行情。当前显示 {source} 在 {time} 的快照，高低点、时间差和收益均按该时刻计算。', 'Reconnecting. The {source} snapshot from {time} is shown. Extremes, elapsed time and P&L use that quote.', '再接続中。{source} の {time} の相場を表示し、高安値・経過時間・損益をその時点で計算しています。', 'Переподключение. Показаны данные {source} за {time}. Экстремумы, время и результат рассчитаны на этот момент.', '재연결 중입니다. {source}의 {time} 시세를 표시하며 고저점, 경과 시간과 손익을 해당 시각 기준으로 계산합니다.'],
  noticeOffline: ['行情源暂时无法连接，恢复连接后会自动更新。', 'Price feed unavailable. Quotes will update when the connection returns.', '相場に接続できません。接続が戻ると自動更新します。', 'Источник котировок недоступен. Данные обновятся после восстановления связи.', '시세에 연결할 수 없습니다. 연결이 복구되면 자동으로 갱신합니다.'],
  changePeriodTip: ['按最近 96 根 15 分钟 K 线首根开盘价计算', 'Measured from the open of the oldest of the last 96 fifteen-minute candles', '直近96本の15分足の最初の始値を基準に算出', 'От цены открытия первой из последних 96 свечей по 15 минут', '최근 15분봉 96개 중 첫 캔들의 시가 대비'],
  today: ['今日', 'Today', '今日', 'Сегодня', '오늘'],
  yesterday: ['昨日', 'Yesterday', '昨日', 'Вчера', '어제'],
  sourceFutures: ['{source} · USDT 永续合约', '{source} · USDT perpetuals', '{source} · USDT建て無期限先物', '{source} · бессрочные фьючерсы USDT', '{source} · USDT 무기한 선물'],
  waitingSource: ['等待行情源', 'Waiting for data source', '配信元に接続中', 'Ожидание источника', '시세 소스 대기 중'],
  connectingSource: ['正在连接行情源', 'Connecting to price feed', '相場に接続中', 'Подключение к котировкам', '시세 연결 중'],
  updated: ['报价更新于 {time}', 'Quote updated {time}', '相場更新 {time}', 'Котировка на {time}', '시세 갱신 {time}'],
  waitingQuote: ['等待报价', 'Awaiting quote', '配信待ち', 'Ожидание котировки', '시세 대기 중'],
  capitalError: ['请输入大于 0 的有效本金。', 'Enter a valid capital amount above zero.', '0より大きい元手を入力してください。', 'Введите сумму капитала больше нуля.', '0보다 큰 유효한 원금을 입력하세요.'],
  entryError: ['请输入大于 0 的有效开仓价。', 'Enter an entry price above zero.', '0より大きい建値を入力してください。', 'Введите цену входа больше нуля.', '0보다 큰 유효한 진입가를 입력하세요.'],
  underDay: ['不到 1 天前', 'Less than a day ago', '1日未満前', 'Менее суток назад', '하루 이내'],
  underMinute: ['不到 1 分钟前', 'Less than a minute ago', '1分未満前', 'Меньше минуты назад', '1분 이내'],
};

Object.assign(messages, {
  markPrice: ['标记价格', 'Mark price', 'マーク価格', 'Цена маркировки', '표시 가격'],
  lastTrade: ['最新成交价', 'Last traded price', '直近約定価格', 'Цена последней сделки', '최근 체결가'],
  indexLevel: ['指数点位', 'Index level', '指数値', 'Значение индекса', '지수 포인트'],
  entryNotional: ['入场名义金额', 'Entry notional', '建玉時の想定元本', 'Номинал при входе', '진입 명목 금액'],
  positionValue: ['当前持仓价值', 'Position value', '現在の建玉評価額', 'Текущая стоимость позиции', '현재 포지션 가치'],
  quantity: ['持仓数量', 'Position size', '建玉数量', 'Объём позиции', '보유 수량'],
  margin: ['保证金（本金）', 'Margin (capital)', '証拠金（元本）', 'Маржа (капитал)', '증거금(원금)'],
  unrealized: ['未实现盈亏', 'Unrealised P&L', '未実現損益', 'Нереализованный P&L', '미실현 손익'],
  pnlReturn: ['收益率', 'Return', '収益率', 'Доходность', '수익률'],
  referenceEntry: ['参考开仓价', 'Reference entry', '参考建値', 'Расчётная цена входа', '참고 진입가'],
  costsIndex: ['未计费用，指数为模拟敞口。', 'Costs excluded. Index exposure is simulated.', '費用は含まず、指数は想定エクスポージャーです。', 'Без учёта затрат. Экспозиция по индексу моделируется.', '비용을 제외하며 지수는 모의 익스포저입니다.'],
  byMark: ['按标记价格计算', 'Based on mark price', 'マーク価格で計算', 'По цене маркировки', '표시 가격 기준'],
  byLast: ['按最新成交价计算', 'Based on last trade', '最新値で計算', 'По цене последней сделки', '최근 체결가 기준'],
  joinBinance: ['一键注册币安', 'Sign up for Binance', 'Binanceに登録', 'Зарегистрироваться на Binance', '바이낸스 가입하기'],
  economyCycle: ['参与经济周期', 'Trade the economic cycle', '景気循環に参加する', 'Участвовать в экономическом цикле', '경기 사이클에 참여하기'],
  followMine: ['关注我的 X', 'Follow me on X', 'Xでフォロー', 'Подписаться на меня в X', 'X에서 팔로우하기'],
  eqGain: ['浮盈购买力', 'Your gain is worth', '含み益の購買力', 'Прибыль сопоставима с', '평가이익 환산'],
  eqLoss: ['浮亏购买力', 'Your loss is worth', '含み損の購買力', 'Убыток сопоставим с', '평가손실 환산'],
  eqDetails: ['参考价与来源', 'Price and source', '参考価格・出典', 'Цена и источник', '기준 가격과 출처'],
  eqViewSource: ['查看数据', 'View data', 'データを見る', 'К данным', '자료 보기'],
  eqShop: ['查看商品', 'View product', '商品を見る', 'К товару', '상품 보기'],
  eqBook: ['查看预订', 'View booking', '予約を見る', 'К бронированию', '예약 보기'],
  eqListings: ['查看房源', 'View listings', '物件を見る', 'К объявлениям', '매물 보기'],
  eqNext: ['换一个', 'Shuffle', '別の例', 'Другой пример', '다른 예시'],
  bankCollateralSource: ['保证金标准来源','Exchange margin standard','証拠金の参考資料','Норматив биржи по марже','증거금 산출 근거'],
  krTab: ['韩国股市','Korea','韓国株','Корея','한국 주식'],
  krAiGroup: ['韩国 AI 产业链 · 按总市值','Korean AI stocks · market cap','韓国AI関連株 · 時価総額順','ИИ-компании Кореи · по капитализации','한국 AI 관련주 · 시가총액순'],
  eqCompare: ['更多换算','Compare values','ほかの換算','Сравнить','다른 환산'],
  principalLabel: ['本金','Principal','元本','Капитал','원금'],
  returnOnCapital: ['本金收益率','Return on capital','元本利益率','Доходность капитала','원금 수익률'],
  simLiquidationNote: ['模拟强平价采用简化逐仓模型，未计费用和交易所阶梯。','The simulated liquidation price uses a simplified isolated position model before fees and exchange tiers.','シミュレーション清算価格は分離マージンの簡易モデルに基づき、手数料と取引所の段階設定は含みません。','Расчёт цены ликвидации основан на упрощённой модели изолированной позиции без комиссий и биржевых уровней.','모의 청산가는 간이 격리 모델 기준이며 수수료와 거래소별 구간은 제외합니다.'],
  officialCollateralNote: ['保证金金额按交易所参考标准计算，期货公司的实收金额可能不同。','Collateral follows the exchange reference. Broker requirements may differ.','証拠金額は取引所基準で計算します。証券会社により異なります。','Обеспечение рассчитано по нормативу биржи. Требования брокера могут отличаться.','증거금 금액은 거래소 기준으로 계산하며 증권사별로 다를 수 있습니다.'],
  positionDetails: ['查看详情','View details','詳細を見る','Подробнее','상세 보기'],
  hidePositionDetails: ['收起详情','Hide details','詳細を閉じる','Свернуть','상세 닫기'],
  entrySettings: ['开仓设置','Entry settings','建値の設定','Настройки входа','진입 설정'],
  priceRebound: ['价格反弹','Price rebound','価格の反発','Отскок цены','반등률'],
  priceDrawdown: ['价格回撤','Price drawdown','価格の下落','Просадка цены','하락률'],
  annualReturn: ['年化收益率','Annual rate','年利','Годовая ставка','연 수익률'],
  incomeWorth: ['收益购买力','Interest is worth','利息の換算','На сумму процентов','이자 환산'],
  eqEnjoy: ['直接平仓，开始享受 😎','Close your position and enjoy 😎','決済して楽しもう 😎','Закрой позицию и наслаждайся 😎','포지션 닫고 즐기기 😎'],
  buyPoint: ['买入点','Buy entry','買い建値','Цена покупки','매수 진입가'],
  sellPoint: ['卖出点','Sell entry','売り建値','Цена продажи','매도 진입가'],
  currentTradePrice: ['当前价格','Current price','現在値','Текущая цена','현재가'],
  rocketVideo: ['分享火箭视频','Share rocket video','ロケット動画を共有','Поделиться видео','로켓 영상 공유'],
  eqCatalog: ['全部对照（{count}）','All comparisons ({count})','全ての換算（{count}）','Все сравнения ({count})','전체 비교 ({count})'],
  eqRelatedVideo: ['同类体验','Similar experience','類似の体験','Похожий опыт','유사 체험'],
  eqVideoOnly: ['仅看有视频的项目','With video only','動画のある項目のみ','Только с видео','영상 있는 항목만'],
  eqSearch: ['搜索商品或体验','Find a product or experience','商品・体験を検索','Найти товар или услугу','상품·체험 검색'],
  eqNoMatch: ['没有匹配的项目','No matches','該当する項目はありません','Совпадений нет','검색 결과 없음'],
  eqSingle: ['单一服务','Single','単品','Отдельно','단일'],
  eqBundle: ['配套服务','Bundle','組み合わせ','Набор','패키지'],
  shareCard: ['生成分享图','Create share image','シェア画像を作成','Создать карточку','공유 이미지 만들기'],
  cycleOverview: ['查看完整连线','Full cycle view','全期間のライン','Весь период','전체 구간 보기'],
  periodVolume: ['区间成交量','Volume over the move','期間出来高','Объём за период','구간 거래량'],
  volumeLoading: ['正在读取成交量','Loading volume','出来高を取得中','Загрузка объёма','거래량 불러오는 중'],
  incompleteVolume: ['该区间成交量暂缺','Period volume unavailable','期間出来高は未取得','Нет объёма за весь период','전체 구간 거래량 미제공'],
  measuredUntil: ['统计至 {time}','Through {time}','{time} まで','По {time}','{time}까지'],
  moveFromMinute: ['从 {count} 分钟 K 线起算','From the {count}-minute candle','{count}分足から集計','С начала свечи {count} мин','{count}분봉 시작부터'],
  dailyPrecision: ['日 K','Daily candle','日足','Дневная свеча','일봉'],
  barPrecision: ['{count} 分钟 K 线','{count}-min candle','{count}分足','Свеча {count} мин','{count}분봉'],
  simulationRate: ['换算汇率','Conversion rate','換算レート','Курс пересчёта','환산 환율'],
  reboundLeg: ['周期低点 → 现价','Cycle low → current','サイクル安値 → 現在値','Минимум цикла → сейчас','주기 저점 → 현재가'],
  retreatLeg: ['高点 → 现价','High → current','高値 → 現在値','Максимум → сейчас','고점 → 현재가'],
  shareEntryCustom: ['自定义开仓价','Custom entry price','指定建値','Своя цена входа','직접 입력한 진입가'],
  shareSavingsStart: ['理财起息','Interest start','利息起算日','Начало начисления','이자 기산일'],
  eqMode: ['换算方式','Comparison mode','換算方法','Способ сравнения','비교 방식'],
  eqNextBundle: ['换一套','New bundle','別の組み合わせ','Другой набор','다른 조합'],
  bundleTotal: ['配套合计','Bundle total','合計','Итого','합계'],
  bundleRemainder: ['尾差按参考金价折算为黄金。','The balance is converted to gold at the reference price.','端数は参考価格で金に換算します。','Остаток пересчитан в золото по справочной цене.','잔액은 기준 금값으로 환산합니다.'],
  bundleTiny: ['金额不足 0.01 {currency}','Below 0.01 {currency}','0.01 {currency} 未満','Менее 0,01 {currency}','0.01 {currency} 미만'],
  eqClose: ['关闭','Close','閉じる','Закрыть','닫기'],
  eqBelowOne: ['不足 1 {unit}','< 1 {unit}','1 {unit}未満','< 1 {unit}','1 {unit} 미만'],
  bankTitle: ['理财', 'Savings', '資産運用', 'Сбережения', '자산 관리'],
  bankBasis: ['2026-01-01 起算 · 北京时间 · 年单利', 'Since Jan 1, 2026 · UTC+8 · simple annual interest', '2026年1月1日から · UTC+8 · 年単利', 'С 01.01.2026 · UTC+8 · простая годовая ставка', '2026년 1월 1일부터 · UTC+8 · 연 단리'],
  bankBalance: ['本息合计', 'Balance with interest', '元利合計', 'Сумма с процентами', '원리금 합계'],
  bankInterest: ['累计利息', 'Interest earned', '累計利息', 'Начисленные проценты', '누적 이자'],
  bankPrincipal: ['理财本金', 'Principal', '運用元本', 'Начальная сумма', '운용 원금'],
  swapDirectionColors: ['互换多空颜色', 'Swap long/short colors', 'ロング・ショートの色を入れ替える', 'Поменять цвета лонга и шорта', '롱·숏 색상 바꾸기'],
  ath: ['历史高点', 'All-time high', '過去最高値', 'Исторический максимум', '역대 고점'],
  trough: ['峰后低点', 'Post-peak low', '最高値更新後の安値', 'Минимум после пика', '고점 이후 저점'],
  locateCandle: ['定位 K 线', 'Find candle', '該当する足へ', 'Найти свечу', '캔들 위치 보기'],
  returnLatest: ['返回最新', 'Back to latest', '最新に戻る', 'К последней свече', '최신으로'],
  goldExtreme: ['金色为周期极值', 'Gold marks cycle extremes', '金色はサイクルの高値・安値', 'Золотым отмечены экстремумы цикла', '금색은 사이클 극값'],
  tradingChange: ['交易日涨跌幅', 'Session change', '取引日の騰落率', 'Изменение за сессию', '거래일 등락률'],
  tradingHigh: ['交易日最高', 'Session high', '取引日の高値', 'Максимум сессии', '거래일 고가'],
  tradingLow: ['交易日最低', 'Session low', '取引日の安値', 'Минимум сессии', '거래일 저가'],
  tradingTrend: ['交易日走势', 'Session trend', '取引日の値動き', 'Динамика сессии', '거래일 가격 추이'],
  latestTradingDay: ['最新交易日', 'Latest trading day', '直近の取引日', 'Последний торговый день', '최근 거래일'],
  priceUnit: ['价格单位', 'Price unit', '価格単位', 'Единица цены', '가격 단위'],
  stockSnapshot: ['证券行情快照', 'Securities snapshot', '証券相場のスナップショット', 'Снимок котировок', '증권 시세 스냅샷'],
  index: ['指数', 'Index', '指数', 'Индекс', '지수'],
  etf: ['ETF', 'ETF', 'ETF', 'ETF', 'ETF'],
  points: ['点', 'pts', 'pt', 'п.', '포인트'],
  exposure: ['模拟敞口', 'Simulated exposure', '想定エクスポージャー', 'Моделируемая экспозиция', '모의 익스포저'],
  tradingClose: ['交易日收盘', 'Session close', '取引日の終値', 'Закрытие сессии', '거래일 종가'],
  hour: ['小时', 'hours', '時間', 'ч', '시간'],
  daily: ['日线', 'Daily', '日足', 'Дневные', '일봉'],
  marketData: ['市场数据', 'Market data', '市場データ', 'Рыночные данные', '시장 데이터'],
  displayRange: ['显示范围', 'Date range', '表示期間', 'Период', '표시 기간'],
  currentZone: ['当前时区', 'Time zone', 'タイムゾーン', 'Часовой пояс', '시간대'],
  latest: ['最新', 'Latest', '最新', 'Последние', '최신'],
  week: ['周', 'Week', '週', 'Неделя', '주'],
  month: ['月', 'Month', '月', 'Месяц', '월'],
  year: ['年', 'Year', '年', 'Год', '년'],
  register: ['注册', 'Sign up', '登録', 'Регистрация', '가입'],
  positions: ['你的持仓', 'Your positions', 'あなたのポジション', 'Ваши позиции', '내 포지션'],
  isolated: ['逐仓模拟', 'Isolated margin', '分離マージンのシミュレーション', 'Модель изолированной маржи', '격리 마진 모의 계산'],
  liquidation: ['模拟强平价', 'Simulated liquidation price', 'シミュレーション清算価格', 'Расчётная цена ликвидации', '모의 청산가'],
  maintenance: ['维持保证金率', 'Maintenance margin rate', '維持証拠金率', 'Ставка поддерживающей маржи', '유지 증거금률'],
  marginRatio: ['保证金率', 'Margin ratio', '証拠金率', 'Коэффициент маржи', '증거금률'],
  referencePrice: ['参考价格', 'Reference price', '参考価格', 'Ориентир цены', '참고 가격'],
  positionCapital: ['持仓本金', 'Position capital', '建玉元本', 'Капитал позиции', '포지션 원금'],
  liquidationNote: ['强平价按固定维持保证金率计算，未计费用及阶梯，不代表账户强平价。', 'The simulated liquidation price uses a fixed maintenance margin rate. Account-specific fees and margin tiers are excluded.', '清算価格は一定の維持証拠金率で計算しています。手数料や段階別の率を含まず、実際の口座の清算価格とは異なります。', 'Расчётная цена ликвидации основана на фиксированной ставке поддерживающей маржи. Комиссии и уровни риска не учтены; цена ликвидации счёта может отличаться.', '고정 유지 증거금률로 청산가를 계산합니다. 수수료와 구간별 요율을 제외하므로 실제 계좌의 청산가와 다를 수 있습니다.'],
  freshLow: ['刷新低后按新低计算', 'Recalculated on a new low', '安値更新時に再計算', 'Пересчёт при новом минимуме', '저점 갱신 시 새 저점으로 재계산'],
  showHigh: ['查看高点 K 线', 'View peak candle', '高値の足を見る', 'Свеча максимума', '고점 캔들 보기'],
  showLow: ['查看低点 K 线', 'View trough candle', '安値の足を見る', 'Свеча минимума', '저점 캔들 보기'],
  goldBar: ['金色 K 线', 'Gold candle', '金色の足', 'Золотая свеча', '금색 캔들'],
  period: ['周期', 'Interval', '時間足', 'Интервал', '주기'],
  latestView: ['最新视图', 'Latest view', '最新表示', 'Последний график', '최신 보기'],
  minute: ['分钟', 'min', '分', 'мин', '분'],
  systemTheme: ['跟随系统', 'System', 'システムに合わせる', 'Системная', '시스템 설정'],
  noCandles: ['没有可用的 K 线', 'No candles available', '表示できる足がありません', 'Свечи недоступны', '표시할 캔들이 없습니다'],
  intraday: ['日内', 'Intraday', '日中', 'Внутри дня', '장중'],
  month1: ['1 个月', '1M', '1か月', '1 мес.', '1개월'],
  month3: ['3 个月', '3M', '3か月', '3 мес.', '3개월'],
  year1: ['1 年', '1Y', '1年', '1 год', '1년'],
  allAssets: ['全部标的', 'All instruments', 'すべての銘柄', 'Все инструменты', '전체 종목'],
  popularAssets: ['热门标的', 'Popular instruments', '注目銘柄', 'Популярные инструменты', '인기 종목'],
  benchmark: ['基准指数', 'Benchmark indices', '主要指数', 'Базовые индексы', '대표 지수'],
  majorEtf: ['主要 ETF', 'Major ETFs', '主要ETF', 'Основные ETF', '주요 ETF'],
  aiStocks: ['热门 AI 股', 'Popular AI stocks', '注目のAI株', 'Популярные акции ИИ', '인기 AI 종목'],
  magSeven: ['美股七巨头', 'Magnificent Seven', 'マグニフィセント・セブン', 'Великолепная семёрка', '매그니피센트 7'],
  tradingDay: ['交易日', 'Trading day', '取引日', 'Торговый день', '거래일'],
  regularHours: ['普通交易时段', 'Regular trading hours', '通常取引時間', 'Основная торговая сессия', '정규 거래 시간'],
  siteName: ['Bulls & Bears', 'Bulls & Bears', 'Bulls & Bears', 'Bulls & Bears', 'Bulls & Bears'],
  simResults: ['模拟结果', 'Simulation results', '計算結果', 'Результаты расчёта', '모의 결과'],
  equityDelay: ['证券报价有延迟，时间以行情源为准。', 'Securities quotes are delayed. Timestamps come from the data source.', '証券価格は遅延配信です。時刻は配信元に準じます。', 'Биржевые котировки поступают с задержкой. Время указано источником.', '증권 시세는 지연되며 표시 시각은 데이터 제공처 기준입니다.'],
  equityNote: ['证券和指数按模拟敞口计算，不含成本。', 'Equity and index results use simulated exposure and exclude costs.', '証券と指数は想定エクスポージャーで計算し、費用は含みません。', 'Акции и индексы рассчитаны по моделируемой экспозиции без учёта затрат.', '증권과 지수는 모의 익스포저 기준이며 비용을 제외합니다.'],
  orderPending: ['低点与高点的时间顺序待确认', 'The order of the high and low is unconfirmed', '高値・安値の前後関係を確認中', 'Порядок максимума и минимума уточняется', '고점과 저점의 선후 관계 확인 중'],
  historyStart: ['引用历史起点', 'Price history starts', '参照履歴の開始日', 'Начало доступной истории', '참조 이력 시작일'],
});

Object.assign(messages, {
  marginReturn: ['保证金收益率', 'Return on margin', '証拠金収益率', 'Доходность на маржу', '증거금 수익률'],
  simMaintenance: ['模拟维持保证金率', 'Simulated maintenance rate', '想定維持証拠金率', 'Расчётная ставка поддерживающей маржи', '모의 유지 증거금률'],
  simUnits: ['模拟份额', 'Simulated units', '想定口数', 'Расчётное количество', '모의 수량'],
  estimateByLast: ['按最新成交价计算盈亏', 'Based on last trade', '直近約定値で計算', 'По последней сделке', '최근 체결가 기준'],
  estimateBySnapshot: ['按快照成交价计算盈亏', 'Based on the saved last price', '保存時の約定値で計算', 'По последней цене снимка', '저장된 체결가 기준'],
  exchangeMark: ['交易所标记价', 'Exchange mark price', '取引所のマーク価格', 'Цена маркировки биржи', '거래소 표시 가격'],
  liquidationReached: ['已达模拟强平线', 'Simulated liquidation reached', '想定清算水準に到達', 'Достигнут порог расчётной ликвидации', '모의 청산 기준 도달'],
  noPositiveLiquidation: ['无正数强平价', 'No positive liquidation price', '正の清算価格なし', 'Нет положительной цены ликвидации', '양수 청산가 없음'],
  maintenanceLimit: ['维持保证金率须小于初始保证金率。', 'Maintenance margin rate must be lower than the initial margin rate.', '維持証拠金率は当初証拠金率より低く設定してください。', 'Ставка поддерживающей маржи должна быть ниже ставки начальной маржи.', '유지 증거금률은 초기 증거금률보다 낮아야 합니다.'],
  indexPoints: ['指数点', 'index points', '指数ポイント', 'пункты индекса', '지수 포인트'],
});

Object.assign(messages, {
  lots: ['手', 'lots', 'ロット', 'лоты', '랏'],
  openDelayed: ['盘中 · 延时报价', 'Open · delayed quotes', '取引中 · 遅延配信', 'Торги идут · с задержкой', '장중 · 지연 시세'],
  awaitingSession: ['等待当日报价', 'Awaiting today’s quote', '当日の配信待ち', 'Ожидание котировки за сегодня', '당일 시세 대기 중'],
  tencentQuote: ['腾讯证券', 'Tencent Finance', 'テンセント・ファイナンス', 'Tencent Finance', '텐센트 파이낸스'],
  splitAdjusted: ['拆股调整、未含股息', 'Split-adjusted, excluding dividends', '株式分割調整済み・配当除く', 'С учётом дроблений, без дивидендов', '주식분할 반영, 배당 제외'],
  securitiesUnavailable: ['暂时无法获取证券行情', 'Securities quotes are temporarily unavailable', '証券相場を取得できません', 'Биржевые котировки временно недоступны', '증권 시세를 일시적으로 불러올 수 없습니다'],
  priceTrend: ['价格走势', 'Price trend', '価格推移', 'Динамика цен', '가격 추이'],
  candleInterval: ['K 线周期', 'Candle interval', 'ローソク足の周期', 'Интервал свечей', '캔들 주기'],
  minute1: ['1 分钟','1 min','1分足','1 мин','1분봉'],
  oneHourWindow: ['近 1 小时','1 hour','直近1時間','1 час','최근 1시간'],
  threeHourWindow: ['近 3 小时','3 hours','直近3時間','3 часа','최근 3시간'],
  minuteByDay: ['按 UTC 日期加载分钟线','Minute candles by UTC date','UTC日付ごとの1分足','Минутные свечи по дате UTC','UTC 날짜별 1분봉'],
  minuteDayFailed: ['该日分钟线暂未取得，请重试或换一天','Minute data unavailable for this day. Retry or choose another date.','この日の1分足を取得できません。再試行するか別の日を選択してください。','Минутные данные за этот день недоступны. Выберите другую дату или повторите.','이 날짜의 분봉을 불러올 수 없습니다. 재시도하거나 날짜를 바꾸세요.'],
  minutes30: ['30 分钟', '30 min', '30分足', '30 мин', '30분봉'],
  hour1: ['1 小时', '1h', '1時間足', '1 ч', '1시간봉'],
  ohlcBrief: ['开高低收', 'Open, high, low, close', '始値・高値・安値・終値', 'Открытие, максимум, минимум, закрытие', '시가·고가·저가·종가'],
  historyAvailable: ['可用历史', 'Available history', '参照期間', 'Доступная история', '제공 이력'],
  securitiesQuote: ['证券行情', 'Securities quote', '証券相場', 'Биржевые котировки', '증권 시세'],
  alreadyClosed: ['已收盘', 'Session closed', '取引終了', 'Торги закрыты', '장 마감'],
  locateFailed: ['无法定位该根 K 线', 'This candle could not be located', '該当する足を表示できません', 'Не удалось найти свечу', '해당 캔들을 찾을 수 없습니다'],
  bullHome: ['刘鲨鱼 Bulls & Bears', 'LiuShaYu Bulls & Bears', 'LiuShaYu Bulls & Bears', 'LiuShaYu Bulls & Bears', 'LiuShaYu Bulls & Bears'],
});

Object.assign(messages, {
  futures: ['期货', 'Futures', '先物', 'Фьючерсы', '선물'],
  indexFutures: ['股指期货', 'Index futures', '株価指数先物', 'Индексные фьючерсы', '주가지수 선물'],
  cffex: ['中金所', 'CFFEX', '中国金融先物取引所', 'CFFEX', '중국금융선물거래소'],
  cffexLong: ['中国金融期货交易所', 'China Financial Futures Exchange', '中国金融先物取引所', 'Китайская биржа финансовых фьючерсов', '중국금융선물거래소'],
  selectIndex: ['选择指数', 'Select index', '指数を選択', 'Выбрать индекс', '지수 선택'],
  futurePicker: ['选择期货合约', 'Select a futures contract', '先物銘柄を選択', 'Выбрать фьючерс', '선물 계약 선택'],
  lotCount: ['交易手数', 'Number of lots', '取引枚数', 'Количество лотов', '거래 계약 수'],
  oneContract: ['1 手', '1 lot', '1枚', '1 лот', '1계약'],
  actualContract: ['真实合约', 'Dated contract', '限月別の実在銘柄', 'Конкретный контракт', '실제 월물'],
  contract: ['合约', 'Contract', '契約', 'Контракт', '계약'],
  frontContract: ['主力合约', 'Most active contract', '中心限月', 'Наиболее активный контракт', '주력 월물'],
  contractMonth: ['合约月份', 'Contract month', '限月', 'Месяц контракта', '결제월'],
  expiryMonth: ['月份', 'Month', '限月', 'Месяц', '월물'],
  multiplier: ['合约乘数', 'Contract multiplier', '取引乗数', 'Множитель контракта', '계약 승수'],
  pointMultiplier: ['每点乘数', 'Value per point', '1ポイント当たりの倍率', 'Множитель на пункт', '포인트당 승수'],
  tickSize: ['最小变动价位', 'Tick size', '呼値の単位', 'Минимальный шаг цены', '최소 가격 변동폭'],
  pointPnl: ['每点盈亏', 'P&L per point', '1ポイント当たり損益', 'P&L на пункт', '포인트당 손익'],
  tickPnl: ['每跳盈亏', 'P&L per tick', '1ティック当たり損益', 'P&L на тик', '틱당 손익'],
  marginOnly: ['保证金', 'Margin', '証拠金', 'Маржа', '증거금'],
  fitMargin: ['保证金比例', 'Margin rate', '証拠金率', 'Ставка маржи', '증거금 비율'],
  exchangeMargin: ['交易所参考保证金', 'Exchange reference margin', '取引所の参考証拠金', 'Расчётная биржевая маржа', '거래소 참고 증거금'],
  exchRate: ['交易所保证金率', 'Exchange margin rate', '取引所証拠金率', 'Ставка биржевой маржи', '거래소 증거금률'],
  brokerMargin: ['期货公司保证金', 'Broker margin', '証券会社の証拠金', 'Брокерская маржа', '선물사 증거금'],
  marginUsed: ['模拟占用保证金', 'Simulated margin used', '想定拘束証拠金', 'Расчётная занятая маржа', '모의 사용 증거금'],
  badLots: ['请输入大于零的整数手数。', 'Enter a positive whole number of lots.', '1枚以上の整数を入力してください。', 'Введите положительное целое число лотов.', '1 이상의 정수 계약 수를 입력하세요.'],
  badMargin: ['保证金比例须大于 0 且不超过 100%。', 'Margin rate must be greater than 0 and at most 100%.', '証拠金率は0%超、100%以下で設定してください。', 'Ставка маржи должна быть больше 0% и не выше 100%.', '증거금 비율은 0%보다 크고 100% 이하여야 합니다.'],
  perContractUnit: ['元／点／手', 'CNY / point / lot', '元／ポイント／枚', 'CNY / пункт / лот', '위안 / 포인트 / 계약'],
  perPoint: ['每点', 'Per point', '1ポイント当たり', 'За пункт', '포인트당'],
  perTick: ['每跳', 'Per tick', '1ティック当たり', 'За тик', '틱당'],
  futuresMarginNote: ['合约保证金按所示比例计算，经纪商的实际要求可能不同。', 'Contract margin is calculated at the rate shown. Broker requirements may differ.', '表示比率で証拠金を計算しています。実際の所要証拠金は取扱会社によって異なります。', 'Маржа рассчитана по указанной ставке. Требования брокера могут отличаться.', '표시된 비율로 계약 증거금을 계산합니다. 실제 증권사 요구 조건은 다를 수 있습니다.'],
  usdtFunding: ['美股本金以 USDT 输入，按 1 USDT = 1 USD 模拟，盈亏以美元显示。', 'Enter US stock capital in USDT. The simulation uses 1 USDT = 1 USD and shows P&L in USD.', '米国株の元手はUSDTで入力します。シミュレーションでは1 USDT＝1 USDとし、損益は米ドルで表示します。', 'Капитал для акций США вводится в USDT. В модели 1 USDT = 1 USD, а результат указан в долларах США.', '미국 주식 원금은 USDT로 입력합니다. 모의 환율은 1 USDT = 1 USD이며 손익은 달러로 표시합니다.'],
  futurePnlNote: ['期指盈亏按手数、合约乘数和报价计算。', 'Index futures P&L uses lots, contract multiplier and price movement.', '指数先物の損益は枚数・取引乗数・価格変動から計算します。', 'Результат индексного фьючерса зависит от числа лотов, множителя и изменения цены.', '지수 선물 손익은 계약 수, 계약 승수, 시세 변동으로 계산합니다.'],
  entryMargin: ['开仓保证金', 'Entry margin', '建玉時の証拠金', 'Маржа при открытии', '진입 증거금'],
  nowMarginUse: ['目前保证金占用', 'Current margin used', '現在の拘束証拠金', 'Текущая занятая маржа', '현재 사용 증거금'],
  upMoveExample: ['每点及每跳盈亏以价格上涨为例。', 'Per-point and per-tick P&L assume an upward move.', '1ポイント・1ティック当たりの損益は値上がりを想定しています。', 'Результат на пункт и тик показан для роста цены.', '포인트당 및 틱당 손익은 가격 상승을 기준으로 합니다.'],
  verifiedRate: ['已核实参考比例', 'Verified reference rate', '確認済み参考比率', 'Проверенная ставка', '확인된 참고 비율'],
  customRate: ['自定义保证金比例', 'Custom margin rate', '証拠金率を指定', 'Своя ставка маржи', '증거금 비율 직접 설정'],
  enterMargin: ['输入保证金比例以模拟占用保证金。', 'Enter a margin rate to calculate margin used.', '証拠金率を入力して拘束証拠金を計算します。', 'Введите ставку для расчёта занятой маржи.', '사용 증거금을 계산하려면 증거금 비율을 입력하세요.'],
  profitLoss: ['盈亏', 'P&L', '損益', 'Прибыль / убыток', '손익'],
  exchangeSettlement: ['结算价', 'Settlement price', '清算値', 'Расчётная цена', '정산가'],
  prevSettlement: ['前结算价', 'Previous settlement', '前日の清算値', 'Пред. расчётная цена', '직전 정산가'],
  rawClose: ['收盘价', 'Closing price', '終値', 'Цена закрытия', '종가'],
  openInterest: ['持仓量', 'Open interest', '建玉残高', 'Открытый интерес', '미결제약정'],
  expiry: ['最后交易日', 'Last trading day', '取引最終日', 'Последний день торгов', '최종 거래일'],
  specifications: ['合约规格', 'Contract specifications', '取引要綱', 'Спецификация контракта', '계약 명세'],
  futuresSource: ['东方财富期货', 'Eastmoney Futures', '東方財富・先物', 'Eastmoney Futures', '이스트머니 선물'],
  futuresQuotes: ['期货行情', 'Futures quotes', '先物相場', 'Котировки фьючерсов', '선물 시세'],
  shareIndex: ['现货指数', 'Cash index', '現物指数', 'Спотовый индекс', '현물 지수'],
  expiryDate: ['到期日', 'Expiry date', '満期日', 'Дата экспирации', '만기일'],
});

Object.assign(messages, {
  since2026: ['2026 年以来','Since Jan 2026','2026年以降','С января 2026','2026년부터'],
  jumpDate: ['定位日期','Go to date','日付を指定','К дате','날짜 이동'],
  showDailyHistory: ['查看日线历史','View daily history','日足履歴を見る','Дневная история','일봉 기록 보기'],
  retryYear: ['重新加载','Retry','再読み込み','Повторить','다시 불러오기'],
  loadingYear: ['正在读取历史 K 线…','Loading candle history…','過去のローソク足を読み込み中…','Загрузка истории свечей…','과거 캔들을 불러오는 중…'],
  yearUnavailable: ['此周期历史暂不可用','History for this interval is unavailable','この足種の履歴を取得できません','История для этого интервала недоступна','이 주기의 기록을 가져올 수 없습니다'],
  yearLimited: ['此周期仅有以下范围','Available history for this interval','この足種の取得可能範囲','Доступный период для этого интервала','이 주기의 제공 범위'],
  yearGap: ['此后数据待补齐','More recent bars are unavailable','以降のデータは未取得','Более свежие свечи недоступны','이후 캔들 미확보'],
  contractListed: ['{contract} 上市于 {date}','{contract} listed {date}','{contract} 上場日 {date}','{contract} торгуется с {date}','{contract} 상장일 {date}'],
  barCount: ['{count} 根','{count} bars','{count}本','Свечей: {count}','{count}개 봉'],
});

const symbols = [
  ['中证1000股指期货', 'CSI 1000 index futures', 'CSI 1000指数先物', 'Фьючерс на CSI 1000', 'CSI 1000 지수 선물'],
  ['中证500股指期货', 'CSI 500 index futures', 'CSI 500指数先物', 'Фьючерс на CSI 500', 'CSI 500 지수 선물'],
  ['沪深300股指期货', 'CSI 300 index futures', 'CSI 300指数先物', 'Фьючерс на CSI 300', 'CSI 300 지수 선물'],
  ['上证50股指期货', 'SSE 50 index futures', '上海50指数先物', 'Фьючерс на SSE 50', '상하이 50 지수 선물'],
  ['纳斯达克 100 ETF', 'Invesco QQQ Trust', 'インベスコQQQトラスト', 'Invesco QQQ Trust', '인베스코 QQQ 트러스트'],
  ['道琼斯工业 ETF', 'SPDR Dow Jones Industrial Average ETF', 'SPDRダウ工業株平均ETF', 'SPDR Dow Jones Industrial Average ETF', 'SPDR 다우존스 산업평균 ETF'],
  ['标普 500 ETF', 'SPDR S&P 500 ETF Trust', 'SPDR S&P 500 ETFトラスト', 'SPDR S&P 500 ETF Trust', 'SPDR S&P 500 ETF 트러스트'],
  ['谷歌 A 类股', 'Alphabet Class A', 'アルファベット クラスA', 'Alphabet, класс A', '알파벳 A주'],
  ['Meta 平台', 'Meta Platforms', 'メタ・プラットフォームズ', 'Meta Platforms', '메타 플랫폼스'],
  ['闪迪', 'SanDisk', 'サンディスク', 'SanDisk', '샌디스크'],
  ['超威半导体', 'Advanced Micro Devices', 'アドバンスト・マイクロ・デバイセズ', 'Advanced Micro Devices', 'AMD'],
  ['帕兰提尔', 'Palantir Technologies', 'パランティア・テクノロジーズ', 'Palantir Technologies', '팔란티어 테크놀로지스'],
  ['台积电 ADR', 'Taiwan Semiconductor ADR', '台湾積体電路製造 ADR', 'Taiwan Semiconductor ADR', 'TSMC ADR'],
  ['中证 1000', 'CSI 1000', 'CSI 1000指数', 'CSI 1000', 'CSI 1000 지수'],
  ['比特币', 'Bitcoin', 'ビットコイン', 'Биткоин', '비트코인'],
  ['币安币', 'BNB', 'BNB', 'BNB', '비앤비'],
  ['索拉纳', 'Solana', 'ソラナ', 'Solana', '솔라나'],
  ['大零币', 'Zcash', 'ジーキャッシュ', 'Zcash', '지캐시'],
  ['标普500指数', 'S&P 500', 'S&P 500指数', 'S&P 500', 'S&P 500 지수'],
  ['纳斯达克综合指数', 'Nasdaq Composite', 'NASDAQ総合指数', 'Nasdaq Composite', '나스닥 종합지수'],
  ['纳斯达克100指数', 'Nasdaq-100', 'NASDAQ 100指数', 'Nasdaq-100', '나스닥 100 지수'],
  ['道琼斯工业平均指数', 'Dow Jones Industrial Average', 'ダウ工業株30種平均', 'Промышленный индекс Доу-Джонса', '다우존스 산업평균지수'],
  ['罗素2000指数', 'Russell 2000', 'ラッセル2000指数', 'Russell 2000', '러셀 2000 지수'],
  ['上证指数', 'SSE Composite', '上海総合指数', 'Shanghai Composite', '상하이 종합지수'],
  ['深证成指', 'SZSE Component', '深圳成分指数', 'Shenzhen Component', '선전 성분지수'],
  ['沪深300', 'CSI 300', 'CSI 300指数', 'CSI 300', 'CSI 300 지수'],
  ['创业板指', 'ChiNext Index', '創業板指数', 'ChiNext', '차이넥스트 지수'],
  ['科创50', 'STAR 50', '科創50指数', 'STAR 50', '커촹 50 지수'],
  ['中证500', 'CSI 500', 'CSI 500指数', 'CSI 500', 'CSI 500 지수'],
  ['上证50', 'SSE 50', '上海50指数', 'SSE 50', '상하이 50 지수'],
  ['苹果', 'Apple', 'アップル', 'Apple', '애플'],
  ['微软', 'Microsoft', 'マイクロソフト', 'Microsoft', '마이크로소프트'],
  ['英伟达', 'NVIDIA', 'エヌビディア', 'NVIDIA', '엔비디아'],
  ['亚马逊', 'Amazon', 'アマゾン', 'Amazon', '아마존'],
  ['谷歌', 'Alphabet', 'アルファベット', 'Alphabet', '알파벳'],
  ['特斯拉', 'Tesla', 'テスラ', 'Tesla', '테슬라'],
  ['博通', 'Broadcom', 'ブロードコム', 'Broadcom', '브로드컴'],
  ['美光科技', 'Micron Technology', 'マイクロン・テクノロジー', 'Micron Technology', '마이크론 테크놀로지'],
  ['甲骨文', 'Oracle', 'オラクル', 'Oracle', '오라클'],
  ['贵州茅台', 'Kweichow Moutai', '貴州茅台酒', 'Kweichow Moutai', '구이저우 마오타이'],
  ['宁德时代', 'CATL', '寧徳時代', 'CATL', 'CATL'],
  ['比亚迪', 'BYD', '比亜迪', 'BYD', '비야디'],
  ['中芯国际', 'SMIC', '中芯国際', 'SMIC', '중신궈지'],
  ['中际旭创', 'Zhongji Innolight', '中際旭創', 'Zhongji Innolight', '중지이노라이트'],
  ['寒武纪', 'Cambricon', '寒武紀', 'Cambricon', '캠브리콘'],
  ['工业富联', 'Foxconn Industrial Internet', '富士康工業互聯網', 'Foxconn Industrial Internet', '폭스콘산업인터넷'],
  ['海光信息', 'Hygon Information', '海光信息', 'Hygon Information', '하이곤 인포메이션'],
];

const staticTranslations = new Map();
const byText = new Map();
for (const [key, entries] of [...Object.entries(messages), ...symbols.map(row => [row[0], row])]) {
  staticTranslations.set(key, entries);
  for (const entry of entries) if (!byText.has(entry)) byText.set(entry, key);
}
const aliases = {
  '1手':'oneContract', '一手':'oneContract', '手数':'lotCount', '最小变动':'tickSize', '交易保证金':'marginOnly',
  '元/点/手':'perContractUnit', '期货合约':'contract', '结算价格':'exchangeSettlement',
  '中证 1000 股指期货':'中证1000股指期货', '中证 500 股指期货':'中证500股指期货',
  '沪深 300 股指期货':'沪深300股指期货', '上证 50 股指期货':'上证50股指期货',
  'A 股': 'cnStocks', '历史起点':'historyStart', '延迟行情':'delayed', '前收盘价':'prevClose', '标普 500 指数':'标普500指数', '纳斯达克 100 指数':'纳斯达克100指数',
  '沪深 300':'沪深300', '中证 500':'中证500', '上证 50':'上证50', '科创 50':'科创50', '股票市场': 'stocks', '证券': 'stocks', 'AI 热门股': 'aiStocks',
  '交易日最高/最低': 'sessionRange', '周/月/年': 'rangeUnits', '白天模式': 'lightMode', '夜间模式': 'darkMode',
  '标普 500': '标普500指数', '标普500': '标普500指数', '纳斯达克100': '纳斯达克100指数', '纳斯达克综合': '纳斯达克综合指数',
  '道琼斯指数': '道琼斯工业平均指数', '道琼斯工业指数': '道琼斯工业平均指数', '罗素2000': '罗素2000指数',
  '深证成份指数': '深证成指', '沪深300指数': '沪深300', '创业板指数': '创业板指', '科创50指数': '科创50',
};
staticTranslations.set('sessionRange', ['交易日最高/最低', 'Session high / low', '取引日の高値／安値', 'Максимум / минимум сессии', '거래일 고가 / 저가']);
staticTranslations.set('rangeUnits', ['周/月/年', 'Week / month / year', '週／月／年', 'Неделя / месяц / год', '주 / 월 / 년']);
for (const [label, key] of Object.entries(aliases)) byText.set(label, key);

export function t(lang, key, params = {}) {
  const rows = staticTranslations.get(key) || staticTranslations.get(byText.get(key));
  const template = rows?.[indices[lang] ?? 0] ?? String(key ?? '');
  return template.replace(/\{(\w+)\}/g, (match, p) => params[p] == null ? match : String(params[p]));
}

const dateFormatters = new Map();
function formatDate(lang, ms, timeZone, format) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const id = [localeFor(lang), timeZone, format].join('/');
  let fmt = dateFormatters.get(id);
  if (!fmt) {
    const part = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    const date = { year: 'numeric', month: '2-digit', day: '2-digit' };
    const fields = format === 'clock' ? part : format === 'date' ? date : { ...date, ...part };
    if (format === 'seconds') fields.second = '2-digit';
    fmt = new Intl.DateTimeFormat(localeFor(lang), { ...fields, timeZone });
    dateFormatters.set(id, fmt);
  }
  return fmt.format(Number(ms));
}
export function dateTime(lang, ms, { seconds = false, timeZone = 'Asia/Shanghai', dateOnly = false } = {}) {
  return formatDate(lang, ms, timeZone, dateOnly ? 'date' : seconds ? 'seconds' : 'minutes');
}
export function clockTime(lang, ms, timeZone = 'Asia/Shanghai') {
  return formatDate(lang, ms, timeZone, 'clock');
}

const elapsedUnits = {
  zh: ['天', '小时', '分钟'], en: ['d', 'h', 'min'], ja: ['日', '時間', '分'],
  ru: ['дн.', 'ч', 'мин'], ko: ['일', '시간', '분'],
};
export function ageText(lang, side, when, asOf) {
  if (![when, asOf].every(Number.isFinite)) return '—';
  if (!(lang in elapsedUnits)) lang = 'zh';
  const ms = Math.max(0, asOf - when);
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  if (side === 'high') {
    if (!days) return t(lang, 'underDay');
    return new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'always' }).format(-days, 'day');
  }
  const minutes = Math.floor(ms / 60000) % 60;
  if (!hours && !minutes) return t(lang, 'underMinute');
  const shortSpan = ms <= 48 * 3600000;
  const parts = shortSpan ? [[hours, 1], [minutes, 2]] : [[days, 0], [hours % 24, 1]];
  const space = lang === 'ru' ? ' ' : '';
  const phrase = parts.filter(([num, unit]) => num > 0 || (!shortSpan && unit === 1))
    .map(([num, i]) => num + space + elapsedUnits[lang][i]).join(lang === 'ja' ? '' : ' ');
  return ({ zh: phrase + '前', en: phrase + ' ago', ja: phrase + '前', ru: phrase + ' назад', ko: phrase + ' 전' })[lang];
}

const translatedNodes = new WeakMap();

export function applyI18n(lang, root = document) {
  const doc = root.ownerDocument || root;
  if (root === doc || root === doc.documentElement) doc.documentElement.lang = localeFor(lang);
  // Translate only text nodes, preserving links, icons and editable form controls.
  const walker = doc.createTreeWalker(root, 4);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('script,style,textarea,[data-i18n-skip]')) continue;
    const label = node.nodeValue.trim();
    // Distinct source labels can have the same translation (e.g. "session high").
    // Preserve a stable key for repeat language switches unless the app changed this text.
    const prior = translatedNodes.get(node);
    const key = prior?.text === label ? prior.key : byText.get(label);
    if (key) {
      const translated = t(lang, key);
      if (translated !== label) node.nodeValue = node.nodeValue.replace(label, translated);
      translatedNodes.set(node, { key, text: translated });
    }
  }
  const attributes = { 'aria-label': 'data-i18n-aria', title: 'data-i18n-title', placeholder: 'data-i18n-placeholder' };
  for (const el of root.querySelectorAll('[data-i18n], [aria-label], [title], [placeholder], [data-i18n-aria], [data-i18n-title], [data-i18n-placeholder]')) {
    if (el.hasAttribute('data-i18n')) {
      const label = t(lang, el.getAttribute('data-i18n'));
      const part = [...el.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
      if (part) part.nodeValue = label;
      else if (el.children.length === 0) el.textContent = label;
      else el.append(doc.createTextNode(label));
    }
    for (const [attr, keyAttr] of Object.entries(attributes)) {
      const key = el.getAttribute(keyAttr) || el.getAttribute(attr);
      if (key && (staticTranslations.has(key) || byText.has(key))) el.setAttribute(attr, t(lang, key));
    }
  }
}
