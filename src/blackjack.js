import {
  ag, arcadeAuth, arcadeStore, arcadeStamp, arcadeUid, arcadeMessage,
  arcadePlayer, arcadeRound, arcadeBusy, chapterPiBalance, setChapterPiBalance,
} from './arcade.js';

// Pi-token Blackjack. Independent of weekly games, XP, CP Tokens and food data.
// Spark/social-game edition: rules validate every move and wallet delta.
// Cards are reproducible from a server-stamped seed; this is NOT a hidden-deck,
// cheat-proof casino. Keep Pi tokens nonredeemable (see README).
const BJ_CONFIG=Object.freeze({minBet:2,maxBet:200,dealerSkin:'classic'});
const BJ_DEALERS=Object.freeze({classic:{name:'The Dealer',assetId:'bjDealerArt'}});
const bjStateRef=uid=>arcadeStore.collection('sparkArcadeBlackjack').doc(uid);
const bjWalletRef=uid=>arcadeStore.collection('sparkArcadePiWallets').doc(uid);
const bjReceiptRef=(uid,id)=>bjStateRef(uid).collection('hands').doc(id);
function bjRejected(code,message){const error=new Error(message);error.code='bj/'+code;throw error;}
function bjRandomStep(seed){return seed*48271%2147483647;}
function bjSeed(stamp){return (Math.floor(stamp.toMillis())%2147483646+stamp.nanoseconds)%2147483646+1;}
function bjValue(card){return Math.min(card%13+1,10);}
function bjAce(card){return card%13===0?1:0;}
function bjTotal(hard,aces){return hard+(aces>0&&hard<=11?10:0);}
function bjHandTotal(cards){const hard=cards.reduce((s,c)=>s+bjValue(c),0),aces=cards.reduce((s,c)=>s+bjAce(c),0);return bjTotal(hard,aces);}
function bjOutcome(h){
 const p=bjTotal(h.pHard,h.pAces),d=bjTotal(h.dHard,h.dAces),pn=h.player.length===2&&p===21,dn=h.dealer.length===2&&d===21;
 return pn&&dn?'push':pn?'blackjack':dn||p>21?'loss':d>21||p>d?'win':p===d?'push':'loss';
}
function bjPayout(h){const result=bjOutcome(h);return result==='blackjack'?h.bet*5/2:result==='win'?h.bet*2:result==='push'?h.bet:0;}
function bjInitialHand(id,bet){return {id,bet,phase:'shuffle',started:arcadeStamp(),updated:arcadeStamp(),revision:0,op:id,rng:0,player:[],dealer:[],pHard:0,pAces:0,dHard:0,dAces:0,payout:0,result:''};}
function bjStepModel(o,action,op){
 const n={...o,revision:o.revision+1,op,updated:arcadeStamp()};
 if(action==='deal'&&o.phase==='shuffle'){
  let rng=bjSeed(o.started);const cards=[];for(let i=0;i<4;i++){rng=bjRandomStep(rng);cards.push(rng%52);}
  n.rng=rng;n.player=[cards[0],cards[2]];n.dealer=[cards[1],cards[3]];
  n.pHard=n.player.reduce((s,c)=>s+bjValue(c),0);n.pAces=n.player.reduce((s,c)=>s+bjAce(c),0);
  n.dHard=n.dealer.reduce((s,c)=>s+bjValue(c),0);n.dAces=n.dealer.reduce((s,c)=>s+bjAce(c),0);
  n.phase=bjTotal(n.pHard,n.pAces)===21||bjTotal(n.dHard,n.dAces)===21?'settling':'player';
 }else if(action==='hit'&&o.phase==='player'){
  n.rng=bjRandomStep(o.rng);const card=n.rng%52;n.player=[...o.player,card];n.pHard+=bjValue(card);n.pAces+=bjAce(card);
  const total=bjTotal(n.pHard,n.pAces);n.phase=total>21?'settling':total===21?'dealer':'player';
 }else if(action==='stand'&&o.phase==='player'){n.phase='dealer';
 }else if(action==='dealer'&&o.phase==='dealer'){
  if(bjTotal(o.dHard,o.dAces)>=17)n.phase='settling';
  else{n.rng=bjRandomStep(o.rng);const card=n.rng%52;n.dealer=[...o.dealer,card];n.dHard+=bjValue(card);n.dAces+=bjAce(card);n.phase=bjTotal(n.dHard,n.dAces)>=17?'settling':'dealer';}
 }else if(action==='settle'&&o.phase==='settling'){n.phase='done';n.result=bjOutcome(o);n.payout=bjPayout(o);
 }else throw new Error('This hand changed. Reconnect to see its latest state.');
 return n;
}
async function bjBegin(id,bet,uid=arcadeUid()){
 if(uid!==arcadeUid())throw new Error('Sign in again before dealing.');
 if(!/^[a-zA-Z0-9-]{10,80}$/.test(id)||!Number.isSafeInteger(bet)||bet<2||bet>200||bet%2)throw new Error('Choose an even wager from 2 to 200 Pi tokens.');
 await arcadeStore.runTransaction(async tx=>{
  const receipt=await tx.get(bjReceiptRef(uid,id));if(receipt.exists)return;
  const old=await tx.get(bjStateRef(uid));if(old.exists&&old.data().id===id)return;
  if(old.exists&&old.data().phase!=='done')bjRejected('active','Finish your saved hand before dealing another.');
  const wallet=await tx.get(bjWalletRef(uid));
  if(!wallet.exists||!Number.isSafeInteger(wallet.data().balance)||wallet.data().balance<bet)bjRejected('funds','You do not have enough Pi tokens for this wager. Earn Pi tokens from the weekly leaderboard.');
  tx.set(bjStateRef(uid),bjInitialHand(id,bet));
  tx.update(bjWalletRef(uid),{balance:wallet.data().balance-bet,updated:arcadeStamp()});
 });
 return (await bjStateRef(uid).get({source:'server'})).data();
}
async function bjMove(action,id,revision,op,uid=arcadeUid()){
 if(uid!==arcadeUid())throw new Error('Sign in again to resume this hand.');
 await arcadeStore.runTransaction(async tx=>{
  const snap=await tx.get(bjStateRef(uid)),o=snap.exists?snap.data():null;
  if(o?.id===id&&o.op===op)return;
  if(!o||o.id!==id||o.revision!==revision)throw new Error('The hand was updated in another tab. Reconnect to continue.');
  const n=bjStepModel(o,action,op);
  if(n.phase==='done'){
   const receipt=await tx.get(bjReceiptRef(uid,id));if(receipt.exists)throw new Error('This hand has already been paid.');
   const wallet=await tx.get(bjWalletRef(uid));if(!wallet.exists)throw new Error('Your Pi-token wallet could not be loaded.');
   tx.update(bjWalletRef(uid),{balance:wallet.data().balance+n.payout,updated:arcadeStamp()});
   tx.set(bjReceiptRef(uid,id),{id,bet:n.bet,payout:n.payout,result:n.result,player:n.player,dealer:n.dealer,settledAt:arcadeStamp()});
  }
  tx.set(bjStateRef(uid),n);
 });
 return (await bjStateRef(uid).get({source:'server'})).data();
}

let bjHand=null,bjBusy=false,bjConnected=false,bjSelected=false,bjWatchUid=null,bjUnsubscribers=[],bjPending=null,bjHasError=false,bjWalletReady=false,bjStateReady=false;
const bjPendingKey=uid=>'chapter-blackjack-pending-'+uid;
function bjReadPending(uid){try{const p=JSON.parse(sessionStorage.getItem(bjPendingKey(uid))||'null');return p&&typeof p.id==='string'&&Number.isSafeInteger(p.bet)?p:null;}catch(e){return null;}}
function bjSavePending(uid,p){bjPending=p;try{p?sessionStorage.setItem(bjPendingKey(uid),JSON.stringify(p)):sessionStorage.removeItem(bjPendingKey(uid));}catch(e){/* Server hand is still the source of truth if storage is blocked. */}}
function bjShowError(e){
 bjHasError=true;const code=e?.code||'';
 ag('bjError').textContent=code.includes('permission-denied')?'Blackjack could not be saved. Ask the admin to publish the matching Blackjack Firestore rules. Reconnect to check your saved hand; do not place a replacement bet.':code.includes('resource-exhausted')?'The free daily game limit has been reached. Your saved hand will still be here after it resets.':code.includes('unavailable')||code.includes('deadline')?'Connection interrupted. Reconnect to check the same hand without placing another bet.':e.message||'Could not connect. Resume this hand when you are back online.';
 ag('bjError').hidden=false;ag('bjRetry').hidden=!arcadeAuth.currentUser;bjRender();
}
function bjClearError(){bjHasError=false;ag('bjError').hidden=true;ag('bjRetry').hidden=true;}
function bjCardHTML(card,hidden=false){
 if(hidden)return '<span class="bj-card bj-back" role="img" aria-label="Face-down card">π</span>';
 const rank=['A','2','3','4','5','6','7','8','9','10','J','Q','K'][card%13],suit=Math.floor(card/13),symbol=['♠','♥','♣','♦'][suit],label=rank+' of '+['spades','hearts','clubs','diamonds'][suit];
 return '<span class="bj-card '+(suit===1||suit===3?'bj-red':'')+'" role="img" aria-label="'+label+'"><span>'+rank+'</span><span class="bj-suit" aria-hidden="true">'+symbol+'</span><span class="bj-bottom" aria-hidden="true">'+rank+'</span></span>';
}
function bjRenderCards(id,cards,hideHole){const el=ag(id),markup=cards?.length?cards.map((c,i)=>bjCardHTML(c,hideHole&&i===1)).join(''):'<span class="bj-card bj-placeholder" aria-hidden="true"></span><span class="bj-card bj-placeholder" aria-hidden="true"></span>';if(el.innerHTML!==markup)el.innerHTML=markup;}
function bjRender(){
 const uid=arcadeAuth.currentUser?.uid,active=!!bjHand&&bjHand.phase!=='done',canPlay=!!uid&&bjConnected&&!bjBusy&&!bjHasError;
 ag('bjBalance').textContent=uid&&bjWalletReady?chapterPiBalance+' π':'— π';
 ag('bjPlayerName').textContent=uid?(arcadePlayer?.name||'Your game account'):'Not signed in';
 ag('bjSignin').hidden=!!uid;
 ag('bjDeal').disabled=!canPlay||active||chapterPiBalance<2||!!bjPending;
 ag('bjDeal').textContent=bjBusy?'Saving…':active?'Hand in progress':bjHand?'Deal next hand':'Deal hand';
 ag('bjBet').disabled=active||bjBusy||!!bjPending;
 ag('bjChips').querySelectorAll('button').forEach(b=>b.disabled=active||bjBusy||!!bjPending);
 ag('bjHit').disabled=!canPlay||bjHand?.phase!=='player';
 ag('bjStand').disabled=!canPlay||bjHand?.phase!=='player';
 ag('bjWager').textContent=(active?bjHand.bet:0)+' π';
 const hideHole=bjHand?.phase==='player';bjRenderCards('bjDealerCards',bjHand?.dealer,hideHole);bjRenderCards('bjPlayerCards',bjHand?.player,false);
 ag('bjDealerTotal').textContent=bjHand?.dealer.length?(hideHole?bjHandTotal([bjHand.dealer[0]])+' + ?':bjTotal(bjHand.dHard,bjHand.dAces)):'—';
 ag('bjPlayerTotal').textContent=bjHand?.player.length?bjTotal(bjHand.pHard,bjHand.pAces):'—';
 let status='Choose your wager to begin.',speech='“Your move.”';
 if(!uid)status='Sign in to take a seat.';
 else if(!bjConnected)status='Connecting to your Pi-token wallet…';
 else if(!bjHand&&chapterPiBalance<2)status='Earn Pi tokens by finishing in the weekly top 20, then come back to the table.';
 else if(bjHand){
  if(bjHand.phase==='shuffle'){status='Bet saved. Dealing your cards…';speech='“Let’s see what you’ve got.”';}
  if(bjHand.phase==='player'){status='Your turn. Hit for another card, or stand.';speech='“Feeling lucky?”';}
  if(bjHand.phase==='dealer'){status='Dealer’s turn…';speech='“House plays its hand.”';}
  if(bjHand.phase==='settling'){status='Saving this hand’s result…';speech='“Count it up.”';}
  if(bjHand.phase==='done'){
   const delta=bjHand.payout-bjHand.bet,verb={blackjack:'Blackjack!',win:'You win.',push:'Push — a tie.',loss:bjTotal(bjHand.pHard,bjHand.pAces)>21?'You bust.':'Dealer wins.'}[bjHand.result];
   status=verb+' '+(delta>0?'+'+delta+' π net. '+bjHand.payout+' π returned to your wallet.':delta===0?bjHand.bet+' π bet returned.':'−'+bjHand.bet+' π. This hand is settled.');
   speech=delta>0?'“Enjoy it while it lasts.”':delta===0?'“We’re even.”':'“House takes this one.”';
  }
 }
 ag('bjStatus').textContent=status;ag('bjDealerSpeech').textContent=speech;
 if(ag('chapterPiBalance')&&uid)ag('chapterPiBalance').textContent=chapterPiBalance+' Pi tokens';
}
function bjStopWatching(){
 bjUnsubscribers.forEach(f=>f());bjUnsubscribers=[];bjWatchUid=null;bjConnected=false;bjStateReady=false;bjWalletReady=false;bjHand=null;bjPending=null;
}
function bjWatch(){
 const uid=arcadeAuth.currentUser?.uid;if(!uid){bjStopWatching();bjRender();return;}
 if(bjWatchUid===uid)return;
 bjStopWatching();bjWatchUid=uid;bjPending=bjReadPending(uid);bjClearError();
 const fail=e=>{if(bjWatchUid!==uid)return;bjConnected=false;bjShowError(e);};
 const ready=()=>{bjConnected=bjWalletReady&&bjStateReady;bjRender();};
 bjUnsubscribers.push(bjWalletRef(uid).onSnapshot({includeMetadataChanges:true},snap=>{
  if(bjWatchUid!==uid||snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;
  setChapterPiBalance(snap.exists?snap.data().balance:0);bjWalletReady=true;ready();
 },fail));
 bjUnsubscribers.push(bjStateRef(uid).onSnapshot({includeMetadataChanges:true},snap=>{
  if(bjWatchUid!==uid||snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;
  bjHand=snap.exists?snap.data():null;bjStateReady=true;
  if(bjPending&&bjHand?.id===bjPending.id)bjSavePending(uid,null);
  ready();
  if(!bjBusy&&!bjHasError&&bjSelected&&bjHand&&['shuffle','dealer','settling'].includes(bjHand.phase))bjRun('resume');
 },fail));
}
async function bjRefresh(uid){
 const [hand,wallet]=await Promise.all([bjStateRef(uid).get({source:'server'}),bjWalletRef(uid).get({source:'server'})]);
 if(arcadeAuth.currentUser?.uid!==uid)return;
 bjHand=hand.exists?hand.data():null;setChapterPiBalance(wallet.exists?wallet.data().balance:0);bjStateReady=bjWalletReady=bjConnected=true;bjRender();
}
async function bjAdvance(uid){
 for(let i=0;i<30;i++){
  if(arcadeAuth.currentUser?.uid!==uid)return;
  const h=bjHand,action={shuffle:'deal',dealer:'dealer',settling:'settle'}[h?.phase];if(!action)return;
  const next=await bjMove(action,h.id,h.revision,crypto.randomUUID(),uid);
  if(arcadeAuth.currentUser?.uid!==uid)return;
  bjHand=next;bjRender();
 }
 throw new Error('Reconnect to finish the saved hand.');
}
async function bjRun(action){
 if(bjBusy)return;const uid=arcadeAuth.currentUser?.uid;if(!uid)return;
 bjBusy=true;bjClearError();bjRender();
 try{
  if(action==='begin'){
   const bet=Number(ag('bjBet').value);
   if(bjPending)throw new Error('Reconnect to check your previous bet first.');
   if(!Number.isSafeInteger(bet)||bet<2||bet>200||bet%2)throw new Error('Use an even wager from 2 to 200 Pi tokens.');
   bjSavePending(uid,{id:crypto.randomUUID(),bet});
   const h=await bjBegin(bjPending.id,bjPending.bet,uid);
   if(arcadeAuth.currentUser?.uid!==uid)return;
   bjHand=h;bjSavePending(uid,null);
  }else if(action==='hit'||action==='stand'){
   if(!bjHand)throw new Error('Reconnect to load your hand.');
   const h=await bjMove(action,bjHand.id,bjHand.revision,crypto.randomUUID(),uid);
   if(arcadeAuth.currentUser?.uid!==uid)return;bjHand=h;
  }else{
   bjPending=bjReadPending(uid);
   if(bjPending){
    const h=await bjBegin(bjPending.id,bjPending.bet,uid);
    if(arcadeAuth.currentUser?.uid!==uid)return;bjHand=h;bjSavePending(uid,null);
   }
   await bjRefresh(uid);
  }
  await bjAdvance(uid);await bjRefresh(uid);
 }catch(e){
  if(arcadeAuth.currentUser?.uid===uid){if((e.code||'').startsWith('bj/'))bjSavePending(uid,null);bjShowError(e);}
 }finally{
  bjBusy=false;bjRender();
 }
}
function bjSelectSection(blackjack){
 if(blackjack&&(arcadeRound||arcadeBusy)){arcadeMessage('Finish your weekly round before switching to Blackjack.');return;}
 bjSelected=!!blackjack;
 ag('chapterWeeklyPanel').hidden=bjSelected;ag('blackjackPanel').hidden=!bjSelected;
 ag('chapterWeeklySection').setAttribute('aria-pressed',String(!bjSelected));
 ag('chapterBlackjackSection').setAttribute('aria-pressed',String(bjSelected));
 if(bjSelected){bjWatch();bjRender();if(bjConnected&&!bjBusy&&!bjHasError)bjRun('resume');}
}
ag('bjDealerName').textContent=BJ_DEALERS[BJ_CONFIG.dealerSkin].name;
ag('chapterWeeklySection').onclick=()=>bjSelectSection(false);
ag('chapterBlackjackSection').onclick=()=>bjSelectSection(true);
ag('bjSigninButton').onclick=()=>{bjSelectSection(false);ag('arcadeAuth').scrollIntoView({behavior:'smooth',block:'center'});ag('arcadeEmail').focus();};
ag('bjBetForm').onsubmit=e=>{e.preventDefault();if(!ag('bjDeal').disabled)bjRun('begin');};
ag('bjHit').onclick=()=>{if(!ag('bjHit').disabled)bjRun('hit');};
ag('bjStand').onclick=()=>{if(!ag('bjStand').disabled)bjRun('stand');};
ag('bjChips').onclick=e=>{const b=e.target.closest('[data-bj-bet]');if(b&&!b.disabled){ag('bjBet').value=b.dataset.bjBet;if(!bjPending){bjClearError();bjRender();}}};
ag('bjBet').addEventListener('input',()=>{if(!bjBusy&&!bjPending){bjClearError();bjRender();}});
ag('bjRetry').onclick=()=>{bjStopWatching();bjWatch();bjRun('resume');};
arcadeAuth.onAuthStateChanged(()=>{bjStopWatching();bjClearError();if(bjSelected)bjWatch();bjRender();});
