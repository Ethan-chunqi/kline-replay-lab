const langIndex={zh:0,en:1,ja:2,ru:3,ko:4};
const singularExceptions={boxes:'box',glasses:'glass',passes:'pass',watches:'watch'};

// The number is the displayed quantity, after the appropriate rounding.
export function quantityUnit(item,lang,number) {
  const unit=item.unit[langIndex[lang]??0];
  if(lang!=='en' || number!=='1')return unit;
  return singularExceptions[unit]??unit.replace(/s$/,'');
}
