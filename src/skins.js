const FLIGHT_SKINS = [{"id":"red","label":"Red","weight":1100,"tier":"Common","description":"Primary color","color":"#b92832"},{"id":"yellow","label":"Yellow","weight":1100,"tier":"Common","description":"Primary color","color":"#c29700"},{"id":"blue","label":"Blue","weight":1100,"tier":"Common","description":"Primary color","color":"#235da8"},{"id":"green","label":"Green","weight":880,"tier":"Uncommon","description":"Solid color","color":"#277039"},{"id":"orange","label":"Orange","weight":880,"tier":"Uncommon","description":"Solid color","color":"#c15a13"},{"id":"purple","label":"Purple","weight":880,"tier":"Uncommon","description":"Solid color","color":"#793db5"},{"id":"pink","label":"Pink","weight":880,"tier":"Uncommon","description":"Solid color","color":"#c62c7c"},{"id":"teal","label":"Teal","weight":880,"tier":"Uncommon","description":"Solid color","color":"#087c80"},{"id":"beer","label":"Beer","weight":200,"tier":"Rare","description":"Amber lager with a foam cap and tiny bubbles"},{"id":"pi","label":"Pi • π","weight":15,"tier":"Rare","description":"Gold π symbols on deep purple"},{"id":"fire","label":"Eagle","weight":200,"tier":"Rare","description":"White eagle feathers, a dark brown body and a golden hooked beak"},{"id":"marble","label":"Marble","weight":200,"tier":"Rare","description":"Silver stone with diagonal mineral veins"},{"id":"carbon","label":"Carbon","weight":200,"tier":"Rare","description":"Dark woven carbon-fiber checks"},{"id":"aurora","label":"Aurora","weight":150,"tier":"Animated","description":"Original moving green, blue and purple gradient"},{"id":"galaxy","label":"Galaxy","weight":100,"tier":"Animated","description":"Original moving violet and blue gradient"},{"id":"tidal","label":"Tidal Flow","weight":60,"tier":"Animated","description":"Animated water ripples"},{"id":"inferno","label":"Living Fire","weight":50,"tier":"Animated","description":"Animated climbing flames"},{"id":"supernova","label":"Supernova","weight":25,"tier":"Animated","description":"Stars over a moving cosmic spectrum"},{"id":"liquidgold","label":"Liquid Gold","weight":200,"tier":"Animated","description":"Flowing metallic gold reflections"},{"id":"lightning","label":"Lightning","weight":80,"tier":"Illustrated","description":"Electric blue with golden lightning"},{"id":"frostbite","label":"Frostbite","weight":120,"tier":"Illustrated","description":"Faceted cyan ice"},{"id":"toxic","label":"Toxic","weight":100,"tier":"Illustrated","description":"Lime slime and bubbles"},{"id":"chrome","label":"Chrome","weight":150,"tier":"Illustrated","description":"Polished silver reflections"},{"id":"tiger","label":"Tiger","weight":200,"tier":"Illustrated","description":"Orange and black tiger stripes"},{"id":"cherryblossom","label":"Cherry Blossom","weight":150,"tier":"Illustrated","description":"Pink with white blossoms"},{"id":"hologram","label":"Hologram","weight":60,"tier":"Illustrated","description":"Cyan holographic scan lines"},{"id":"phantom","label":"Phantom","weight":40,"tier":"Illustrated","description":"Violet smoke and teal wisps"}];

let ARCADE_SKINS=FLIGHT_SKINS;
let ARCADE_TOTAL_WEIGHT = ARCADE_SKINS.reduce((n,s)=>n+s.weight,0);
const arcadeSkinById=id=>ARCADE_SKINS.find(s=>s.id===id);
const arcadeOdds=s=>(s.weight/ARCADE_TOTAL_WEIGHT*100).toLocaleString('en-US',{maximumFractionDigits:2})+'%';
function arcadeRewardAt(ticket){let end=0;for(const s of ARCADE_SKINS){end+=s.weight;if(ticket<end)return s.id;}throw new Error('Invalid reward ticket');}
function arcadeRandomReward(){const n=new Uint32Array(1),limit=Math.floor(4294967296/ARCADE_TOTAL_WEIGHT)*ARCADE_TOTAL_WEIGHT;do{crypto.getRandomValues(n);}while(n[0]>=limit);return arcadeRewardAt(n[0]%ARCADE_TOTAL_WEIGHT);}
function arcadeSkinBounds(id){let start=0;for(const s of ARCADE_SKINS){const end=start+s.weight/ARCADE_TOTAL_WEIGHT*360;if(s.id===id)return {start,end};start=end;}throw new Error('Unknown skin');}
function arcadeSpinTarget(id,angle){const b=arcadeSkinBounds(id),target=(360-(b.start+b.end)/2)%360;return angle+1080+((target-angle%360+360)%360);}

const ARCADE_ILLUSTRATED=['default',...ARCADE_SKINS.map(s=>s.id)];
function arcadeBirdClass(skin){return 'arcade-bird-art';}
function arcadeBirdHTML(color,extra=''){
 const skin=arcadeSkinById(color)?color:'default';
 return '<span class="arcade-character-bird arcade-bird-art arcade-'+skin+' '+extra+'" aria-hidden="true"></span>';
}
function arcadeBuildWheel(){const wheel=document.getElementById('arcadeWheel');if(!wheel)return;wheel.replaceChildren();wheel.setAttribute('role','img');wheel.setAttribute('aria-label','Reward wheel. Slice sizes match the odds listed below.');for(const s of ARCADE_SKINS){const {start,end}=arcadeSkinBounds(s.id),points=['50% 50%'];const steps=Math.max(1,Math.ceil((end-start)/2));for(let i=0;i<=steps;i++){const a=(start+(end-start)*i/steps-90)*Math.PI/180;points.push((50+50*Math.cos(a))+'% '+(50+50*Math.sin(a))+'%');}const slice=document.createElement('div');slice.className='arcade-slice arcade-'+s.id;slice.style.clipPath='polygon('+points.join(',')+')';slice.title=s.label+' · '+arcadeOdds(s);slice.setAttribute('aria-hidden','true');wheel.append(slice);}
const legend=document.getElementById('arcadeOdds');if(legend){legend.replaceChildren();for(const s of [...ARCADE_SKINS].sort((a,b)=>b.weight-a.weight||a.label.localeCompare(b.label))){const row=document.createElement('div');row.className='arcade-odds-item';const swatch=document.createElement('i');swatch.className='arcade-swatch '+(FLIGHT_SKINS.some(f=>f.id===s.id)?'arcade-bird-art ':'')+'arcade-'+s.id;swatch.setAttribute('aria-hidden','true');row.append(swatch,document.createTextNode(s.label+' · '+arcadeOdds(s)));legend.append(row);}}}
document.addEventListener('DOMContentLoaded',arcadeBuildWheel);

// ARCADE_SKINS / ARCADE_TOTAL_WEIGHT are module-local `let`s. ES modules forbid
// assigning to an imported binding, so arcade.js swaps catalogs through here.
export function setArcadeSkins(list) {
  ARCADE_SKINS = list;
  ARCADE_TOTAL_WEIGHT = list.reduce((n, sk) => n + sk.weight, 0);
}

export {
  FLIGHT_SKINS, ARCADE_SKINS, ARCADE_ILLUSTRATED,
  arcadeSkinById, arcadeBirdClass, arcadeBirdHTML, arcadeBuildWheel,
  arcadeRandomReward, arcadeSpinTarget,
};
