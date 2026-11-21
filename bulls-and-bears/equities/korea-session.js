// KRX regular trading. 2026 closures through November match the independently
// published KOSPI/KOSDAQ sessions. Christmas and year-end are also exchange holidays.
const closures = new Set(('2026-01-01 2026-02-16 2026-02-17 2026-02-18 2026-03-02 '+
  '2026-05-01 2026-05-05 2026-05-25 2026-06-03 2026-07-17 2026-08-17 2026-09-24 '+
  '2026-09-25 2026-10-05 2026-10-09 2026-12-25 2026-12-31').split(' '));

export function koreanHours(date) {
  if (date==='2026-11-19') return [600,990];
  if (date==='2026-01-02') return [600,930];
  return [540,930];
}

export function koreanSession(raw,now,wall) {
  if (!raw) return 'unknown';
  const zone='Asia/Seoul';
  const today=wall(now,zone);
  const [open,close]=koreanHours(today.date);
  const localDay=new Date(today.date+'T12:00:00Z');
  function dayOff() {
    const weekday=localDay.getUTCDay();
    return weekday===0 || weekday===6 || closures.has(localDay.toISOString().slice(0,10));
  }
  const off=dayOff();
  if (off || today.minutes<open) {
    do { localDay.setUTCDate(localDay.getUTCDate()-1); } while (dayOff());
  }
  const day=localDay.toISOString().slice(0,10);
  if (wall(raw.tradeDay,zone).date!==day) return 'unknown';
  if (off || today.minutes<open || today.minutes>=close) {
    const actualClose=raw.sessionEnd || raw.tradeDay+koreanHours(day)[1]*60000;
    return raw.asOf>=actualClose-120000 ? 'closed' : 'unknown';
  }
  return now-raw.asOf<45*60000 ? 'open' : 'unknown';
}
