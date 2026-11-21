// ACT/365 fixed, simple interest with a common start for all markets.
const startMs = Date.parse('2026-01-01T00:00:00+08:00');
const yearSeconds = 365 * 24 * 60 * 60;
const annualRate = 0.03;

export function bankValue(principal, now) {
  if (!(principal > 0 && Number.isFinite(principal) && Number.isFinite(now))) return null;
  const elapsed = Math.max(0, Math.floor((now - startMs) / 1000));
  const perSecond = principal * annualRate / yearSeconds;
  const interest = perSecond * elapsed;
  return {interest, balance:principal + interest, precision:Math.min(16,Math.max(2,Math.ceil(-Math.log10(perSecond))))};
}

export function createBankComparison(host,{t,num,readAmount}) {
  host.innerHTML = '<div class="bank-heading"><div><b data-bank-label="bankTitle"></b><span class="bank-rate">3%</span></div><small data-bank-label="bankBasis"></small></div>' +
    '<div class="bank-figure"><span data-bank-label="bankBalance"></span><strong id="bank-balance">—</strong></div>' +
    '<div class="bank-figure bank-earned"><span data-bank-label="bankInterest"></span><strong id="bank-interest">—</strong></div>' +
    '<div class="bank-funding"><label for="bank-input" data-bank-label="bankPrincipal"></label><strong id="bank-principal"></strong>' +
    '<div class="input-wrap" hidden><input id="bank-input" inputmode="decimal" type="text" autocomplete="off"><span>CNY</span></div></div>';
  const field=host.querySelector('#bank-input');
  const funding=host.querySelector('#bank-principal');
  const amount=host.querySelector('#bank-balance');
  const accrued=host.querySelector('#bank-interest');
  let state, language, principal=10000;
  const storageKey='bulls-bears-bank-cny-principal';
  try {
    const previous=Number(localStorage.getItem(storageKey));
    if (Number.isFinite(previous) && previous>0) principal=previous;
  } catch {}
  function paint() {
    if (!state) return;
    const {lang,currency,future,capital}=state;
    const p=future?readAmount(field.value,lang):capital;
    const value=bankValue(p,Date.now());
    if (future) field.setAttribute('aria-invalid',String(!value));
    const balance=value ? num(lang,value.balance,value.precision)+' '+currency : '—';
    const earned=value ? '+'+num(lang,value.interest,value.precision)+' '+currency : '—';
    if(amount.textContent!==balance) amount.textContent=balance;
    if(accrued.textContent!==earned) accrued.textContent=earned;
  }
  function update(next) {
    const changed=language!==next.lang;
    if (changed) {
      for(const node of host.querySelectorAll('[data-bank-label]')) node.textContent=t(next.lang,node.dataset.bankLabel);
      field.value=num(next.lang,principal,0,8);
      language=next.lang;
    }
    state=next;
    field.parentElement.hidden=!next.future;
    funding.hidden=next.future;
    funding.textContent=next.capital>0?num(next.lang,next.capital,2)+' '+next.currency:'—';
    paint();
  }
  field.addEventListener('input',()=>{
    const value=readAmount(field.value,language);
    if (value>0 && Number.isFinite(value)) {
      principal=value;
      try {localStorage.setItem(storageKey,String(value));} catch {}
    }
    paint();
  });
  const tick=setInterval(()=>{if(!document.hidden) paint();},1000);
  document.addEventListener('visibilitychange',paint);
  return {update,destroy(){clearInterval(tick);document.removeEventListener('visibilitychange',paint);}};
}
