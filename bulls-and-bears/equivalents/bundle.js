import {quotePerDollar} from './rates.js?v=20261122-comparisons';

// Each list offers complementary activities and equipment for one outing or project.
const themes = [
  ['bangkok-bbw-2026','phuket-month','airtag-single','iphone-18-pro','canon-r5ii','icloud-50gb'],
  ['beijing-jingshan','beijing-metro','beijing-summer-palace','beijing-temple-heaven','palace-museum','badaling-winter','water-cube-swim','brompton-cline','canon-r5ii'],
  ['shanghai-maglev','shanghai-astronomy','shanghai-disney-day','chengdu-panda','luoyang-longmen','jiuzhaigou-winter','dunhuang-mogao','shenzhen-foot','airtag-single','iphone-18-pro','canon-r5ii'],
  ['nyc-ferry','citibike-day','film-forum','met-opera-rush','moma-ny','nyc-citypass','one-world-deck','corning-glass','amtrak-usa-rail-pass','nyc-haircut'],
  ['costco-hot-dog','ikea-bag','costco-gold-star','amtrak-usa-rail-pass','alcatraz-day','disneyland-anaheim','venetian-gondola','national-parks-nonresident','toyota-corolla','airstream-bambi','airstream-atlas-25rt'],
  ['apple-music-cn','icloud-50gb','squier-sonic','airpods-pro-3','ipad-a16','blackwing-pencils','iphone-duo','film-forum','met-opera-rush','steinway-model-d'],
  ['puget-whales','waikiki-surf','missouri-admission','perris-tandem','nyc-climb','national-parks-nonresident','brompton-cline','serengeti-migration','churchill-bears','quark-antarctica','south-pole-night','everest-expedition','canon-r5ii'],
  ['shanghai-astronomy','houston-astronaut-breakfast','kennedy-training','celestron-cpc1100','ipad-a16','canon-r5ii','airtag-single','national-parks-nonresident'],
  ['indycar-ride','honda-rebel','mercedes-c300','porsche-911-turbos','perris-tandem','brompton-cline','canon-r5ii','airstream-atlas-25rt'],
  ['world-jet-tour','south-pole-night','serengeti-migration','quark-antarctica','churchill-bears','waikiki-surf','puget-whales','airtag-single','canon-r5ii','rolex-submariner','beneteau-grand-trawler'],
  ['guangzhou-90m2','shanghai-90m2','beijing-90m2','manhattan-median','ikea-billy','ikea-pokal','aeropress-original','concept2-rowerg','steinway-model-d','mercedes-c300','porsche-911-turbos'],
];
const groupTickets = new Set(['beijing-metro','nyc-ferry','costco-hot-dog']);
const properties = new Set(['guangzhou-90m2','shanghai-90m2','beijing-90m2','manhattan-median']);
const pricingCache = new WeakMap();
const formatCents = new Intl.NumberFormat('en-US',{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2});
const maxDetailedAmount = 2 ** 44;

function decimalRatio(value) {
  const [whole,fraction=''] = String(value).split('.');
  return [BigInt(whole + fraction),10n ** BigInt(fraction.length)];
}

function getPricing(items,currency) {
  let currencies = pricingCache.get(items);
  if (!currencies) pricingCache.set(items,currencies=new Map());
  if (currencies.has(currency)) return currencies.get(currency);

  const marketRate=quotePerDollar(currency);
  const [marketNum,marketDen]=decimalRatio(marketRate);
  const entries=new Map();
  for (const item of items.values()) {
    const sourceRate=quotePerDollar(item.currency);
    if (!(item.price>0) || !Number.isFinite(item.price) || !Number.isFinite(sourceRate)) continue;
    const [priceNum,priceDen]=decimalRatio(item.price);
    const [sourceNum,sourceDen]=decimalRatio(sourceRate);
    const num=100n*priceNum*marketNum*sourceDen;
    const den=priceDen*marketDen*sourceNum;
    const service=item.linkType==='booking'||groupTickets.has(item.id);
    const cap=groupTickets.has(item.id)?8:service?4:1;
    // Round the extended line price once, including its currency conversion.
    const charge=quantity=>Number((2n*num*BigInt(quantity)+den)/(2n*den));
    const charges=Array.from({length:cap+1},(_,quantity)=>charge(quantity));
    entries.set(item.id,{item,service,charges,charge,unit:Number(num)/Number(den)});
  }
  const groups=themes.map(ids=>ids.map(id=>entries.get(id)).filter(Boolean)).filter(group=>group.length);
  const pricing={gold:entries.get('sge-gold'),groups,plans:new Map()};
  currencies.set(currency,pricing);
  return pricing;
}

function draftPlan(group,budget,firstShare,multipleHomes) {
  let remaining=budget;
  const lines=[];
  const used=new Set();
  // Leave room for two or three other activities before filling the last slot.
  for (const share of [firstShare,0.69,0.82,1]) {
    const target=remaining*share;
    let best=null, bestScore=-Infinity;
    for (const entry of group) {
      if (used.has(entry)) continue;
      function consider(quantity,cost) {
        if (cost<1||cost>remaining) return;
        const fit=1-Math.abs(cost-target)/Math.max(target,1);
        const score=fit+(entry.service?0.055:0)-Math.min(quantity-1,5)*0.018;
        if (score>bestScore) {
          bestScore=score;
          best={entry,quantity,cost};
        }
      }
      for (let q=1;q<entry.charges.length;q++) consider(q,entry.charges[q]);
      // At portfolio scale use real-estate units to absorb the budget rather than thousands of tickets.
      if (multipleHomes && properties.has(entry.item.id)) {
        for (const q of [Math.floor(target/entry.unit),Math.floor(remaining/entry.unit)]) {
          if(q>1) consider(q,entry.charge(q));
        }
      }
    }
    if (!best) break;
    used.add(best.entry);
    lines.push(best);
    remaining-=best.cost;
  }
  const serviceCount=lines.filter(line=>line.entry.service).length;
  return {lines, coverage:1-remaining/budget,
    score:1-remaining/budget+Math.min(lines.length,3)*0.025+Math.min(serviceCount,2)*0.012};
}

function getPlans(pricing,budget,marketRate) {
  if (pricing.plans.has(budget)) return pricing.plans.get(budget);
  const plans=[],seen=new Set();
  const multipleHomes=budget/100/marketRate>=1_000_000;
  for (const group of pricing.groups) {
    for (const share of [0.57,0.78,0.93]) {
      const plan=draftPlan(group,budget,share,multipleHomes);
      if (!plan.lines.length) continue;
      const signature=plan.lines.map(line=>line.entry.item.id+':'+line.quantity).sort().join('|');
      if (!seen.has(signature)) {seen.add(signature);plans.push(plan);}
    }
  }
  plans.sort((a,b)=>b.score-a.score);
  // Keep alternate packages close in purchasing power to the best available fit.
  const eligible=plans.filter(plan=>plan.score>=plans[0].score-0.075 && plan.coverage>=plans[0].coverage-0.08);
  if (pricing.plans.size>=48) pricing.plans.delete(pricing.plans.keys().next().value);
  pricing.plans.set(budget,eligible);
  return eligible;
}

export function buildBundle(amount,currency,items,variant=0) {
  const empty={lines:[],total:0,digits:2};
  const rate=quotePerDollar(currency);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || !items?.values) return empty;
  const total=Math.abs(amount);
  const pricing=getPricing(items,currency);
  // Beyond this range a Number cannot reliably carry every cent through independent line amounts.
  if (total>=maxDetailedAmount) {
    if (!pricing.gold) return empty;
    const rounded=Number(formatCents.format(total));
    return {lines:[{item:pricing.gold.item,quantity:rounded/(pricing.gold.unit/100),amount:rounded,measured:true}],total:rounded,digits:2};
  }
  const cents=Number(formatCents.format(total).replace('.',''));
  if (!cents) return empty;
  // Plan on a stable three-significant-digit budget; only the gold balance follows small quote ticks.
  const step=10**Math.max(0,Math.floor(Math.log10(cents))-2);
  const budget=Math.floor(cents/step)*step;
  const plans=getPlans(pricing,budget,rate);
  const seed=Number.isFinite(variant)?Math.trunc(variant):0;
  const plan=plans.length?plans[((seed%plans.length)+plans.length)%plans.length]:null;
  const lines=(plan?.lines??[]).map(({entry,quantity,cost})=>({item:entry.item,quantity,amount:cost/100,measured:false}));
  const spent=(plan?.lines??[]).reduce((sum,line)=>sum+line.cost,0);
  const balance=cents-spent;
  if (balance>0 && pricing.gold) {
    lines.push({item:pricing.gold.item,quantity:balance/pricing.gold.unit,amount:balance/100,measured:true});
  }
  return {lines,total:(pricing.gold?cents:spent)/100,digits:2};
}
