import {createEquivalent} from './equivalents/view.js?v=20261122-editorial-2';

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

export function createBankComparison(host,{t,num,readAmount,detailsToggle,shareButton}) {
  host.innerHTML = '<div class="result-head"><b class="position" data-bank-label="bankTitle"></b><span class="result-label" data-bank-label="bankInterest"></span></div>' +
    '<div class="result-price"><strong id="bank-interest">—</strong><span class="bank-unit"></span></div>' +
    '<div class="position-metrics"><div><span data-bank-label="annualReturn"></span><b>3%</b></div>' +
    '<div><span data-bank-label="bankBalance"></span><b id="bank-balance">—</b></div></div><div class="value-equivalent" hidden></div>' +
    '<div class="bank-funding"><label for="bank-input" data-bank-label="bankPrincipal"></label><div class="input-wrap" hidden>' +
    '<input id="bank-input" inputmode="decimal" type="text" autocomplete="off"><span>CNY</span></div></div>' +
    '<details class="position-details">' + detailsToggle() + '<p class="bank-basis" data-bank-label="bankBasis"></p>' +
    '<dl class="position-table"><div><dt data-bank-label="bankPrincipal"></dt><dd id="bank-principal"></dd></div></dl></details>'+shareButton('savings');
  const equivalent=createEquivalent(host.querySelector('.value-equivalent'),t,'incomeWorth');
  const unit=host.querySelector('.bank-unit');
  const field=host.querySelector('#bank-input');
  const funding=host.querySelector('#bank-principal');
  const amount=host.querySelector('#bank-balance');
  const accrued=host.querySelector('#bank-interest');
  let state, language, shareValue, principal=10000;
  const storageKey='bulls-bears-bank-cny-principal';
  try {
    const previous=Number(localStorage.getItem(storageKey));
    if (Number.isFinite(previous) && previous>0) principal=previous;
  } catch {}
  function paint() {
    if (!state) return;
    const {lang,currency,future,capital}=state;
    const p=future?readAmount(field.value,lang):capital;
    const asOf=Date.now(), value=bankValue(p,asOf);
    if (future) field.setAttribute('aria-invalid',String(!value));
    const balance=value ? num(lang,value.balance,value.precision)+' '+currency : '—';
    const earned=value ? '+'+num(lang,value.interest,value.precision) : '—';
    if(unit.textContent!==currency) unit.textContent=currency;
    funding.textContent=value ? num(lang,p,2)+' '+currency : '—';
    equivalent.update(value?.interest,currency,lang,'savings');
    if(amount.textContent!==balance) amount.textContent=balance;
    shareValue=value ? {pnl:value.interest,pnlText:earned+' '+currency,roiText:num(lang,value.interest/p*100,2)+'%',
      asOf,capitalText:funding.textContent,leverageText:'1×',entryNotionalText:funding.textContent,entryKind:'savings',entryBasisText:t(lang,'shareSavingsStart'),
      entryPriceText:'—',entryAt:startMs}:null;
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
    field.closest('.bank-funding').hidden=!next.future;
    field.parentElement.hidden=!next.future;
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
  return {update,snapshot:()=>shareValue?{...shareValue,...equivalent.snapshot()}:null,destroy(){clearInterval(tick);document.removeEventListener('visibilitychange',paint);}};
}
