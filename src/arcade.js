import { db } from './firebase.js';
import { isAdminLoggedIn } from './meals.js';
import {
  FLIGHT_SKINS, ARCADE_SKINS, ARCADE_ILLUSTRATED, setArcadeSkins,
  arcadeSkinById, arcadeBirdClass, arcadeBirdHTML, arcadeBuildWheel,
  arcadeRandomReward, arcadeSpinTarget,
} from './skins.js';

const CHAPTER_GAMES=['flap','stack'];
const CHAPTER_SKINS={flap:FLIGHT_SKINS,
 stack:[{id:'stack_ocean',label:'Ocean Glass',weight:45,color:'#38bdf8'},{id:'stack_sunset',label:'Sunset',weight:30,color:'#fb923c'},{id:'stack_jade',label:'Jade',weight:15,color:'#34d399'},{id:'stack_neon',label:'Neon Tower',weight:8,color:'#e879f9'},{id:'stack_cosmos',label:'Cosmic Tower',weight:2,color:'#a78bfa'}]};

let chapterSelections={},chapterInventory={},chapterCollectionGame='flap',chapterPiBalance=0,chapterResults=[],chapterWins=new Map(),chapterSelectionWatch=null,chapterSelectionWeek=null,chapterExtrasBusy=false;

// Chapter Arcade: isolated from the existing food data and admin password.
const arcadeAuth=firebase.auth();
// Spark edition: Authentication + Firestore only. No Cloud Functions or billing.
const arcadeStore=firebase.firestore();
const arcadeStamp=()=>firebase.firestore.FieldValue.serverTimestamp();
const arcadeProfileRef=uid=>arcadeStore.collection('sparkArcadePlayers').doc(uid);
const arcadeStatsRef=(week,uid)=>arcadeStore.collection('sparkArcadeWeeks').doc(week).collection('players').doc(uid);
const arcadeBoardRef=(week,uid)=>arcadeStore.collection('sparkArcadeBoards').doc(week).collection('players').doc(uid);
const arcadeFail=message=>{throw new Error(message);};
function arcadeUid(){return arcadeAuth.currentUser?.uid||arcadeFail('Sign in to your game account first.');}
function arcadeLocalParts(ms){return Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms).map(p=>[p.type,p.value]));}
function arcadeMidnight(localMs){let t=localMs;for(let i=0;i<3;i++){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(t).map(p=>[p.type,p.value]));t+=localMs-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);}return t;}
let arcadeReleasedWeek=null;
function arcadeScheduleAt(now,isAdmin){
  const p=arcadeLocalParts(now),
  day=Date.UTC(+p.year,+p.month-1,+p.day),
  dow=new Date(day).getUTCDay(),
  // FIX: Treat Sunday (0) as the start of the new week (-1) instead of the end of the old week (6)
  mon=day-(dow===0?-1:dow-1)*86400000,
  publicOpens=null,
  adminOpens=arcadeMidnight(mon-1*86400000),
  closes=arcadeMidnight(mon+5*86400000),
  opens=adminOpens,
  index=((Math.floor((mon-Date.UTC(2026,8,7))/604800000)%2)+2)%2;
  return {
    week:new Date(mon).toISOString().slice(0,10),
    key:String(mon),
    game:chapterSelections[String(mon)]||['flap','stack'][index],
    open:CHAPTER_GAMES.includes(chapterSelections[String(mon)]||['flap','stack'][index])&&now>=adminOpens&&now<closes&&(!!isAdmin||arcadeReleasedWeek===String(mon)),
    released:arcadeReleasedWeek===String(mon),
    opens,adminOpens,publicOpens,closes,
    earlyAccess:!!isAdmin&&arcadeReleasedWeek!==String(mon)&&now>=adminOpens&&now<closes,
    nextOpen:now<opens?opens:arcadeMidnight(mon+6*86400000),
    serverNow:now,
    zone:'America/Chicago'
  };
}
async function arcadeReadRelease(){await chapterReadSelection();const s=arcadeScheduleAt(arcadeNow());const snap=await arcadeStore.collection('sparkArcadeReleases').doc(s.key).get({source:'server'});arcadeReleasedWeek=snap.exists&&snap.data().released===true?s.key:null;}
async function arcadeReleaseCurrentWeek(){const button=ag('arcadeReleaseButton'),message=ag('arcadeReleaseMessage');button.disabled=true;try{const uid=arcadeUid();if(!await arcadeCheckAdmin(uid))throw new Error('Sign in to your verified game-admin account in Games first.');const s=arcadeScheduleAt(arcadeNow(),true);if(!s.open)throw new Error('Release is available Sunday through Friday, Central Time.');const ref=arcadeStore.collection('sparkArcadeReleases').doc(s.key);await arcadeStore.runTransaction(async tx=>{const old=await tx.get(ref);if(old.exists&&old.data().released===true)return;const selectionRef=arcadeStore.collection('sparkArcadeSelections').doc(s.key),selection=await tx.get(selectionRef),lock=await tx.get(arcadeStore.collection('sparkArcadeLocks').doc(s.key));if(!selection.exists&&!lock.exists)tx.set(selectionRef,{game:s.game,chosenBy:uid,updated:arcadeStamp()});tx.set(ref,{released:true,releasedBy:uid,releasedAt:arcadeStamp()});});arcadeReleasedWeek=s.key;arcadeStatus=arcadeScheduleAt(arcadeNow(),true);message.textContent='This week’s game is open to everyone until Friday at 11:59 PM CT.';button.textContent='This week’s game is open';arcadeRenderSchedule();}catch(e){message.textContent=arcadeError(e);button.disabled=false;}}
let arcadeReleaseUnsubscribe=null,arcadeReleaseWatchWeek=null;
function arcadeWatchRelease(){const s=arcadeScheduleAt(arcadeNow());if(arcadeReleaseWatchWeek===s.key)return;if(arcadeReleaseUnsubscribe)arcadeReleaseUnsubscribe();arcadeReleaseWatchWeek=s.key;arcadeReleaseUnsubscribe=arcadeStore.collection('sparkArcadeReleases').doc(s.key).onSnapshot(snap=>{if(snap.metadata.fromCache)return;arcadeReleasedWeek=snap.exists&&snap.data().released===true?s.key:null;arcadeStatus=arcadeScheduleAt(arcadeNow(),arcadeIsAdmin);arcadeRenderSchedule();},e=>{arcadeReleasedWeek=null;arcadeStatus=null;arcadeRenderSchedule();arcadeMessage(arcadeError(e));arcadeReleaseWatchWeek=null;});}
async function arcadeCheckAdmin(uid){try{const doc=await arcadeStore.collection('sparkArcadeAdmins').doc(uid).get({source:'server'});return doc.exists&&doc.data().enabled===true;}catch(e){return false;}}
function arcadePublicProfile(p){return {...p,level:1+Math.floor(p.xp/100),spins:Math.floor(p.xp/100)-p.usedSpins};}
function arcadeWriteMirrors(tx,uid,p,writeBoard=true){
 if(!p.week)return;
 tx.set(arcadeStatsRef(p.week,uid),{...p.stats,name:p.name,equipped:p.equipped});
 // Gameplay: publish only an improved personal best, never a round start.
 // Explicit skin changes still refresh an existing positive-score entry.
 if(writeBoard&&p.stats.best>0)tx.set(arcadeBoardRef(p.week,uid),{name:p.name,equipped:p.equipped,score:p.stats.best});
}
async function arcadeCall(name,data={}){
 if(name==='RemoveScore')return arcadeRemoveScore(data);
 if(name==='Status'){await arcadeReadRelease();const snap=await db.ref('.info/serverTimeOffset').once('value');arcadeOffset=Number(snap.val())||0;arcadeIsAdmin=arcadeAuth.currentUser?await arcadeCheckAdmin(arcadeAuth.currentUser.uid):false;return arcadeScheduleAt(arcadeNow(),arcadeIsAdmin);}
 if(name==='Board'){const s=arcadeScheduleAt(arcadeNow()),snap=await arcadeStore.collection('sparkArcadeBoards').doc(s.key).collection('players').orderBy('score','desc').limit(50).get({source:'server'});return {week:s.week,players:snap.docs.map(d=>({id:d.id,...d.data()}))};}
 const uid=arcadeUid(),ref=arcadeProfileRef(uid);
 if(name==='Profile'){const p=await arcadeStore.runTransaction(async tx=>{const old=await tx.get(ref);if(old.exists)return old.data();const n=String(data.name||'').trim();if(!/^[A-Za-z0-9 _-]{3,20}$/.test(n))arcadeFail('Choose a display name with 3–20 letters, numbers, spaces, hyphens or underscores.');const p={name:n,xp:0,usedSpins:0,owned:['default'],equipped:'default',week:'',stats:null,active:null,lastResult:null,lastSpin:null,updated:arcadeStamp()};tx.set(ref,p);return p;});return arcadePublicProfile(p);}
 if(name==='Start'){await arcadeReadRelease();const isAdmin=await arcadeCheckAdmin(uid);const s=arcadeScheduleAt(arcadeNow(),isAdmin);if(!s.open)arcadeFail(isAdmin?'Admin access starts Sunday. A previously selected retired game stays closed; choose a supported game next Sunday.':'This week’s game opens when an admin releases it. Check back soon.');const id=crypto.randomUUID();await arcadeStore.runTransaction(async tx=>{const p=(await tx.get(ref)).data();const lockRef=arcadeStore.collection('sparkArcadeLocks').doc(s.key),lock=await tx.get(lockRef);if(!p)arcadeFail('Create your player profile first.');if(lock.exists&&lock.data().game!==s.game)arcadeFail('The selected game changed. Refresh before playing.');if(!lock.exists)tx.set(lockRef,{game:s.game,weekMillis:Number(s.key),lockedBy:uid,lockedAt:arcadeStamp()});if(p.active&&arcadeNow()-p.active.started.toMillis()<3000)arcadeFail('Wait a moment before restarting.');const stats=p.week===s.key?{...p.stats}:{starts:0,completed:0,seconds:0,best:0,totalScore:0};stats.starts++;const next={...p,week:s.key,stats,active:{id,started:arcadeStamp(),game:s.game},updated:arcadeStamp()};tx.set(ref,next);arcadeWriteMirrors(tx,uid,next,false);});const saved=(await ref.get({source:'server'})).data();if(saved.active?.id!==id)arcadeFail('Another tab started a round. Start again here.');return {...s,id,serverNow:saved.active.started.toMillis()};}
 if(name==='Finish'){
  await arcadeReadRelease();
  const isAdmin=await arcadeCheckAdmin(uid),scheduleNow=arcadeScheduleAt(arcadeNow(),isAdmin);
  const recordRef=arcadeStore.collection('sparkArcadeRecords').doc(scheduleNow.key);
  // A competing finish can change the benchmark before rules evaluate this
  // commit. Retry a denied commit only after confirming a document we read
  // changed, and always reuse the round ID so XP cannot be awarded twice.
  for(let attempt=0;attempt<3;attempt++){
  let observed=null;
  // Existing leaderboard is the starting benchmark when this feature is installed.
  const top=await arcadeStore.collection('sparkArcadeBoards').doc(scheduleNow.key).collection('players').orderBy('score','desc').limit(1).get({source:'server'});
  const leaderRef=top.empty?null:top.docs[0].ref;
  try{return await arcadeStore.runTransaction(async tx=>{
   const player=await tx.get(ref),p=player.data();if(p?.lastResult?.id===data.id)return p.lastResult;
   if(!p?.active||p.active.id!==data.id)arcadeFail('This round is no longer active.');
   const s=arcadeScheduleAt(arcadeNow(),isAdmin);if(!s.open||p.week!==s.key||s.key!==scheduleNow.key)arcadeFail('The weekly challenge has closed.');
   const record=await tx.get(recordRef),leader=leaderRef?await tx.get(leaderRef):null;
   observed=[{ref,snap:player},{ref:recordRef,snap:record},...(leader?[{ref:leaderRef,snap:leader}]:[])].map(d=>({ref:d.ref,value:JSON.stringify(d.snap.exists?d.snap.data():null)}));
   const previousBest=Math.max(record.exists?record.data().score:0,leader?.exists?leader.data().score:0,p.stats.best);
   const seconds=Math.max(0,Math.floor((arcadeNow()-p.active.started.toMillis())/1000)),score=data.score;
   if(seconds>605||!Number.isSafeInteger(score)||score<0)arcadeFail('This round could not be saved.');
   const highScoreBonus=score>previousBest?100:0,baseEarned=Math.floor(score*5/16);
   const earned=baseEarned+highScoreBonus,xp=p.xp+earned;
   // Keep a reference to the existing leader so rules can check a legacy
   // week's benchmark even if that week has no global-record document yet.
   const baselineUid=leader?.exists?leaderRef.id:'';
   const result={id:data.id,score,seconds,earned,levels:Math.floor(xp/100)-Math.floor(p.xp/100),highScoreBonus,baselineUid};
   const next={...p,xp,active:null,lastResult:result,stats:{...p.stats,completed:p.stats.completed+1,seconds:p.stats.seconds+seconds,best:Math.max(p.stats.best,score),totalScore:p.stats.totalScore+score},updated:arcadeStamp()};
   tx.set(ref,next);arcadeWriteMirrors(tx,uid,next,score>p.stats.best);
   // Record, score and XP commit together only on an actual record break.
   if(highScoreBonus===100)tx.set(recordRef,{score,previousBest,baselineUid,playerUid:uid,roundId:data.id,updated:arcadeStamp()});
   return result;
  });}catch(error){
   if(attempt===2||!String(error.code||'').includes('permission-denied')||!observed)throw error;
   const fresh=await Promise.all(observed.map(d=>d.ref.get({source:'server'})));
   const latest=fresh[0].data();if(latest?.lastResult?.id===data.id)return latest.lastResult;
   if(!latest?.active||latest.active.id!==data.id)arcadeFail('This round is no longer active.');
   if(fresh.every((snap,i)=>JSON.stringify(snap.exists?snap.data():null)===observed[i].value))throw error;
  }
  }
 }
 if(name==='Spin'){await chapterReadSelection();const game=arcadeScheduleAt(arcadeNow()).game;chapterUseCatalog(game);const id=String(data.requestId||'');if(!/^[a-zA-Z0-9-]{10,80}$/.test(id))arcadeFail('Missing spin identifier.');const receipt=ref.collection('spins').doc(id);return arcadeStore.runTransaction(async tx=>{const old=await tx.get(receipt);if(old.exists)return old.data();const p=(await tx.get(ref)).data();const invRef=chapterInventoryRef(uid,game),snap=game==='flap'?null:await tx.get(invRef),inv=game==='flap'?p:snap.exists?snap.data():chapterDefaultInventory();if(!p||p.usedSpins>=Math.floor(p.xp/100))arcadeFail('Level up to earn a spin.');const reward=arcadeRandomReward(),duplicate=inv.owned.includes(reward),result={id,reward,duplicate,game};tx.update(ref,{...(duplicate?{xp:p.xp+50}:{}),usedSpins:p.usedSpins+1,...(game==='flap'?{owned:duplicate?p.owned:[...p.owned,reward]}:{}),lastSpin:result,updated:arcadeStamp()});if(game!=='flap')tx.set(invRef,{owned:duplicate?inv.owned:[...inv.owned,reward],equipped:inv.equipped,updated:arcadeStamp()});tx.set(receipt,result);return result;});}
 if(name==='Equip'){await chapterReadSelection();const game=data.game||chapterCollectionGame;if(game!==arcadeScheduleAt(arcadeNow()).game)arcadeFail('This game collection is view-only until the game is active.');if(game==='flap'){await arcadeStore.runTransaction(async tx=>{const p=(await tx.get(ref)).data();if(!p?.owned.includes(data.color))arcadeFail('Unlock this color first.');if(p.equipped===data.color)return;const next={...p,equipped:data.color,updated:arcadeStamp()};tx.set(ref,next);arcadeWriteMirrors(tx,uid,next);});}else{await arcadeStore.runTransaction(async tx=>{const invRef=chapterInventoryRef(uid,game),snap=await tx.get(invRef),inv=snap.exists?snap.data():chapterDefaultInventory();if(!inv.owned.includes(data.color))arcadeFail('Unlock this skin first.');tx.set(invRef,{...inv,equipped:data.color,updated:arcadeStamp()});});}return {ok:true};}
 if(name==='AwardXP'){
  if(!isAdminLoggedIn())arcadeFail('Open the password-protected Admin tab first.');
  if(!await arcadeCheckAdmin(uid))arcadeFail('Sign in to your game-admin account in Games, then return to Admin.');
  const amount=Number(data.amount),id=String(data.requestId||'');
  if(!Number.isSafeInteger(amount)||amount<1||amount>100000)arcadeFail('Enter a whole number from 1 to 100,000 XP.');
  if(!/^[a-zA-Z0-9-]{10,80}$/.test(id))arcadeFail('Missing award identifier.');
  const playerRef=arcadeProfileRef(data.uid),receipt=playerRef.collection('xpAwards').doc(id);
  return arcadeStore.runTransaction(async tx=>{
   const existing=await tx.get(receipt);if(existing.exists)return existing.data();
   const snap=await tx.get(playerRef);if(!snap.exists)arcadeFail('This player has no game profile.');
   const p=snap.data(),xp=p.xp+amount;if(!Number.isSafeInteger(xp))arcadeFail('This award exceeds the XP limit.');
   const award={amount,adminUid:uid,beforeXP:p.xp,afterXP:xp,created:arcadeStamp()};
   tx.update(playerRef,{xp,updated:arcadeStamp()});tx.set(receipt,award);return award;
  });
 }
 if(name==='Stats'){const admin=await arcadeStore.collection('sparkArcadeAdmins').doc(uid).get({source:'server'});if(!admin.exists||admin.data().enabled!==true)arcadeFail('This game account has not been assigned game-admin access.');const week=data.week||arcadeScheduleAt(arcadeNow()).week,ms=Date.parse(week+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(week)||!Number.isFinite(ms)||new Date(ms).getUTCDay()!==1)arcadeFail('Choose a Monday.');let players=[],last=null;do{let q=arcadeStore.collection('sparkArcadeWeeks').doc(String(ms)).collection('players').orderBy(firebase.firestore.FieldPath.documentId()).limit(200);if(last)q=q.startAfter(last);const snap=await q.get({source:'server'});players.push(...snap.docs.map(d=>({id:d.id,...d.data()})));last=snap.size===200?snap.docs.at(-1):null;}while(last);const finalized=(await arcadeStore.collection('sparkArcadeResults').doc(String(ms)).get({source:'server'})).exists;return {week,players,finalized};}
 arcadeFail('Unknown game action.');
}

async function arcadeRemoveScore(data){
 const adminUid=arcadeUid();
 if(!isAdminLoggedIn()||!await arcadeCheckAdmin(adminUid))arcadeFail('Sign in to your verified game-admin account and open Admin first.');
 const targetUid=String(data.uid||''),week=String(data.week||''),ms=Date.parse(week+'T00:00:00Z'),id=String(data.requestId||'');
 if(!targetUid||targetUid.length>128||targetUid.includes('/'))arcadeFail('Choose a valid player.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(week)||!Number.isFinite(ms)||new Date(ms).getUTCDay()!==1||new Date(ms).toISOString().slice(0,10)!==week)arcadeFail('Choose a Monday for the week.');
 if(!/^[a-zA-Z0-9-]{10,80}$/.test(id))arcadeFail('Missing removal identifier.');
 const key=String(ms),playerRef=arcadeProfileRef(targetUid),boardRef=arcadeBoardRef(key,targetUid),statsRef=arcadeStatsRef(key,targetUid),recordRef=arcadeStore.collection('sparkArcadeRecords').doc(key);
 const receiptRef=arcadeStore.collection('sparkArcadeScoreRemovals').doc(key).collection('actions').doc(id);
 return arcadeStore.runTransaction(async tx=>{
  const old=await tx.get(receiptRef);if(old.exists)return old.data();
  const finalized=await tx.get(arcadeStore.collection('sparkArcadeResults').doc(key));
  if(finalized.exists)arcadeFail('This week’s rewards are already finalized. Score removal is available before finalization.');
  const player=await tx.get(playerRef),board=await tx.get(boardRef),stats=await tx.get(statsRef),record=await tx.get(recordRef);
  const p=player.exists?player.data():null,b=board.exists?board.data():null,s=stats.exists?stats.data():null;
  const current=p?.week===key,removedScore=Math.max(b?.score||0,s?.best||0,current?p.stats?.best||0:0);
  const removedRecord=record.exists&&(record.data().playerUid===targetUid||record.data().score<=removedScore);
  if(board.exists)tx.delete(boardRef);
  if(s&&s.best!==0)tx.update(statsRef,{best:0});
  if(current)tx.update(playerRef,{stats:{...p.stats,best:0},active:null,lastResult:null,updated:arcadeStamp()});
  // Remove an invalid benchmark; the next finish reads the remaining live
  // leaderboard and creates a record only if that actual high score is beaten.
  // No stale "runner-up" query can overwrite a concurrently improved score.
  if(removedRecord)tx.delete(recordRef);
  const receipt={uid:targetUid,week,adminUid,removedScore,removedRecord,name:s?.name||p?.name||b?.name||'Player',created:arcadeStamp()};
  tx.set(receiptRef,receipt);return receipt;
 });
}

const ag=id=>document.getElementById(id);
const arcadeTitles={flap:'Flappy Flight',stack:'Stack Tower',blocks:'Block Drop',snake:'Snake Sprint'};
let arcadeColorIds=['default',...ARCADE_SKINS.map(s=>s.id)];
let arcadeUser=null,arcadePlayer=null,arcadeStatus=null,arcadeOffset=0,arcadeEngine=null,arcadeRound=null,arcadeBusy=false,arcadeSpinBusy=false,arcadeWheelAngle=0,arcadeBoardBusy=false,arcadeIsAdmin=false;
function arcadeMessage(s){ag('arcadeNotice').textContent=s;}
function arcadeError(e){const code=e.code||'';return code.includes('wrong-password')||code.includes('user-not-found')||code.includes('invalid-credential')?'Email or password is incorrect.':code.includes('email-already-in-use')?'An account already uses this email. Sign in or reset your password.':code.includes('unavailable')||code.includes('internal')||code.includes('not-found')?'The game service is unavailable. Please try again later.':code.includes('resource-exhausted')?'The free daily game limit has been reached. Please try again after it resets.':code.includes('permission-denied')?'The game request was denied. Check your account, the play window, and the game setup rules.':code.includes('operation-not-allowed')?'Account creation is not enabled yet. Please contact the chapter admin.':e.message||'Something went wrong. Please try again.';}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Crowns follow the displayed weekly ranking; they never enter collision geometry.
let arcadeCrownRanks=new Map(),arcadeCrownWeek=null,arcadeBoardWatch=null,arcadeBoardWatchWeek=null;
const arcadeCrownMetals=['','gold','silver','bronze'];
const arcadeCrownSVG='<svg viewBox="0 0 30 24" aria-hidden="true"><path d="M3 7L9 12L15 3L21 12L27 7L24 21H6Z" fill="currentColor" stroke="var(--crown-edge)" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 17H23" stroke="#fff" stroke-opacity=".6"/><circle cx="15" cy="13" r="2" fill="#fff" fill-opacity=".85"/></svg>';
function arcadeCrownHTML(rank){const metal=arcadeCrownMetals[rank];return metal?'<span class="arcade-crown arcade-crown-'+metal+'" role="img" aria-label="'+metal+' crown, rank '+rank+'">'+arcadeCrownSVG+'</span>':'';}
function arcadeLeaderboardCharacter(rank,color,week){
 if(chapterActiveGame()!=='flap')return '<span class="chapter-board-icon">'+(rank===1?'👑':'◆')+'</span>';
 const metal=arcadeCrownMetals[rank],skin=FLIGHT_SKINS.some(s=>s.id===color)?color:'default';
 return '<span class="arcade-leader-character" role="img" aria-label="'+(arcadeSkinById(skin)?.label||'Default')+' bird'+(metal?' wearing a '+metal+' crown':'')+'"><span aria-hidden="true">'+(metal?arcadeCrownHTML(rank):'')+chapterFlightBirdHTML(skin,'arcade-character')+'</span></span>';
}
function arcadeCurrentCrownRank(){return arcadeCrownWeek===arcadeScheduleAt(arcadeNow()).key?arcadeCrownRanks.get(arcadeUser?.uid)||0:0;}
function arcadeApplyBoard(players,week){
 players=players.filter(p=>p.score>0);arcadeCrownWeek=week;arcadeCrownRanks=new Map(players.slice(0,3).map((p,i)=>[p.id,i+1]));
 ag('gameLbBody').innerHTML=players.length?players.map((p,i)=>'<tr><td>'+(i+1)+'</td><td>'+arcadeLeaderboardCharacter(i+1,p.equipped,week)+arcadeNameHTML(p.name,p.equipped)+(chapterWins.has(p.id)?'<span class="chapter-win-badge" title="Permanent weekly wins"> 👑 '+chapterWins.get(p.id).wins+'</span>':'')+'</td><td>'+p.score+'</td><td><span class="chapter-pi-pill">'+chapterPiReward(i+1)+' π</span></td></tr>').join(''):'<tr><td colspan="4">No scores yet this week. Be the first to play.</td></tr>';if(arcadePlayer)chapterRenderAccount();
}
function arcadeNameHTML(name,color){return '<span class="arcade-name arcade-'+(arcadeColorIds.includes(color)?color:'default')+'">'+escapeHtml(name)+'</span>';}
function arcadeNow(){return Date.now()+arcadeOffset;}
function arcadeOpen(){return arcadeStatus&&arcadeStatus.open&&arcadeNow()<arcadeStatus.closes;}
async function arcadeLoadProfile(){if(!arcadeUser)return;arcadePlayer=await arcadeCall('Profile',{name:ag('arcadeName').value.trim()||arcadeUser.displayName||''});await chapterLoadInventory();arcadeRenderProfile();}
function arcadeRenderProfile(){ag('arcadeAuth').hidden=!!arcadePlayer;ag('arcadeProfile').hidden=!arcadePlayer;if(!arcadePlayer)return;ag('arcadePlayerName').innerHTML=arcadeNameHTML(arcadePlayer.name,arcadePlayer.equipped);ag('arcadePlayerAvatar').innerHTML=arcadeBirdHTML(arcadePlayer.equipped);ag('arcadeLevel').innerHTML=[[arcadePlayer.level,'Level'],[arcadePlayer.xp,'Lifetime XP'],[arcadePlayer.spins,'CP Tokens']].map(([n,label])=>'<div class="arcade-player-metric"><strong>'+n+'</strong><span>'+label+'</span></div>').join('');ag('arcadeProgress').value=arcadePlayer.xp%100;ag('arcadeSpin').textContent='Spin the wheel · '+arcadePlayer.spins+' CP Token'+(arcadePlayer.spins===1?'':'s')+' available';ag('arcadeSpin').disabled=arcadeSpinBusy||!arcadePlayer.spins||!CHAPTER_GAMES.includes(chapterActiveGame());ag('arcadeColors').innerHTML=arcadePlayer.owned.filter(c=>arcadeColorIds.includes(c)).map(c=>'<button class="nav-btn" data-color="'+c+'" aria-pressed="'+(c===arcadePlayer.equipped)+'">'+arcadeBirdHTML(c,'arcade-collection-bird')+'<span class="arcade-name arcade-'+c+'">'+(arcadeSkinById(c)?.label||'Default')+'</span></button>').join('');chapterRenderAccount();}
async function arcadeAuthenticate(register){if(!ag('arcadeAuthForm').reportValidity())return;const name=ag('arcadeName').value.trim();if(register&&!/^[A-Za-z0-9 _-]{3,20}$/.test(name)){arcadeMessage('Choose a display name with 3–20 letters, numbers, spaces, hyphens or underscores.');return;}const buttons=ag('arcadeAuthForm').querySelectorAll('button');buttons.forEach(b=>b.disabled=true);arcadeMessage('');try{if(arcadeUser){await arcadeLoadProfile();return;}if(register){const credential=await arcadeAuth.createUserWithEmailAndPassword(ag('arcadeEmail').value.trim(),ag('arcadePassword').value);await credential.user.updateProfile({displayName:name});}else await arcadeAuth.signInWithEmailAndPassword(ag('arcadeEmail').value.trim(),ag('arcadePassword').value);ag('arcadePassword').value='';}catch(e){arcadeMessage(arcadeError(e));}finally{buttons.forEach(b=>b.disabled=false);}}
ag('arcadeAuthForm').addEventListener('submit',e=>{e.preventDefault();arcadeAuthenticate(false);});
ag('arcadeRegister').onclick=()=>arcadeAuthenticate(true);
ag('arcadeReset').onclick=async()=>{const email=ag('arcadeEmail');if(!email.reportValidity())return;try{await arcadeAuth.sendPasswordResetEmail(email.value.trim());arcadeMessage('If this email has an account, check its inbox for a reset link.');}catch(e){arcadeMessage(arcadeError(e));}};
ag('arcadeSignout').onclick=async()=>{await arcadeFinishRound();await arcadeAuth.signOut();};
arcadeAuth.onAuthStateChanged(async user=>{arcadeUser=user;arcadePlayer=null;arcadeRenderProfile();if(user){try{await arcadeLoadProfile();}catch(e){arcadeMessage(arcadeError(e)+' If your profile is new, enter a display name and select Sign in to finish setup.');}}else{arcadeIsAdmin=false;chapterPiBalance=0;chapterInventory={};}if(ag('view-game').classList.contains('active'))await initGameView();});
ag('arcadeColors').onclick=async e=>{const b=e.target.closest('[data-color]');if(!b)return;b.disabled=true;try{await arcadeCall('Equip',{color:b.dataset.color,game:chapterCollectionGame});await arcadeLoadProfile();await renderGameLeaderboard();}catch(e){arcadeMessage(arcadeError(e));}finally{b.disabled=false;}}
ag('arcadeSpin').onclick=async()=>{if(arcadeSpinBusy)return;arcadeSpinBusy=true;arcadeRenderProfile();let key='arcadePendingSpin:'+arcadeUser.uid;try{let requestId=sessionStorage.getItem(key);if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}const result=await arcadeCall('Spin',{requestId});sessionStorage.removeItem(key);chapterUseCatalog(result.game||'flap');arcadeWheelAngle=arcadeSpinTarget(result.reward,arcadeWheelAngle);ag('arcadeWheel').style.transform='rotate('+arcadeWheelAngle+'deg)';ag('arcadeSpinResult').textContent='Spinning…';await new Promise(r=>setTimeout(r,matchMedia('(prefers-reduced-motion: reduce)').matches?0:8100));ag('arcadeSpinResult').textContent=(result.duplicate?'Already collected: ':'Unlocked: ')+(arcadeSkinById(result.reward)?.label||result.reward)+'. '+(result.duplicate?'Duplicate color — +50 XP added!':'Select it above to equip it.');await arcadeLoadProfile();}catch(e){arcadeMessage(arcadeError(e));}finally{arcadeSpinBusy=false;arcadeRenderProfile();}};
async function initGameView(){try{const before=Date.now();arcadeStatus=await arcadeCall('Status');arcadeWatchRelease();chapterWatchSelection();chapterUseCatalog(arcadeStatus.game);chapterCollectionGame=arcadeStatus.game;arcadeOffset=arcadeStatus.serverNow-(before+Date.now())/2;arcadeMessage('');arcadeRenderSchedule();await renderGameLeaderboard();if(arcadePlayer)arcadeRenderProfile();chapterLoadExtras();}catch(e){arcadeStatus=null;arcadeRenderSchedule();arcadeMessage(arcadeError(e));}}
function arcadeRenderSchedule(){chapterRewardCountdown();if(arcadeStatus&&arcadeNow()>=arcadeStatus.closes)arcadeStatus.open=false;const open=arcadeOpen();ag('arcadeWaiting').hidden=!!open;ag('arcadePlayable').hidden=!open;if(!arcadeStatus){ag('arcadeSchedule').textContent='Availability could not be confirmed';ag('arcadeCountdown').textContent='Refresh to check the next challenge.';return;}const s=arcadeStatus;ag('arcadeSchedule').textContent=open?'NOW PLAYING · '+(s.earlyAccess?'Admin early access · ':'')+arcadeTitles[s.game]:'ARCADE CLOSED';if(open){ag('arcadeGameName').textContent=arcadeTitles[s.game];ag('arcadeInstructions').textContent=s.game==='flap'?'Tap the game or press Space to flap. Clear gaps for 1 point each. The course gradually speeds up and climbs and drops get harder as your score rises.':s.game==='stack'?'Tap or press Space to place a block. Overhang is cut away. Build the tallest tower; one point per block.':s.game==='blocks'?'Move and rotate falling blocks to clear rows. 100 points per row. Use the buttons below or arrow keys; Space drops.':'Guide the snake to the gold squares. 10 points each. Swipe, use arrow keys, or tap the direction buttons.';}else{const left=Math.max(0,s.nextOpen-arcadeNow()),hours=Math.floor(left/3600000),minutes=Math.floor(left/60000)%60;ag('arcadeCountdown').textContent=arcadeIsAdmin?'Admin access begins Sunday at 12:00 AM CT.':arcadeNow()>=s.closes?'This week’s game has ended. Wait for next week’s release.':'Waiting for an admin to open this week’s game.';if(!CHAPTER_GAMES.includes(s.game))ag('arcadeCountdown').textContent='This week used a retired game. Choose Flappy Flight or Stack for the new week on Sunday.';if(arcadeEngine){arcadeEngine.stop();arcadeEngine=null;}arcadeRound=null;ag('arcadeStart').disabled=false;ag('arcadeEnd').disabled=true;ag('arcadeCanvasHost').replaceChildren();ag('arcadeControls').replaceChildren();} }
setInterval(()=>{if(ag('view-game').classList.contains('active')){if(arcadeStatus&&!arcadeStatus.open&&arcadeNow()>=arcadeStatus.nextOpen)initGameView();else arcadeRenderSchedule();}},15000);
async function renderGameLeaderboard(){
 if(arcadeBoardBusy)return;arcadeBoardBusy=true;
 const week=arcadeScheduleAt(arcadeNow()).key;
 const query=arcadeStore.collection('sparkArcadeBoards').doc(week).collection('players').orderBy('score','desc').limit(50);
 const apply=snap=>arcadeApplyBoard(snap.docs.map(d=>({id:d.id,...d.data()})),week);
 try{
  if(arcadeBoardWatch&&arcadeBoardWatchWeek===week){apply(await query.get({source:'server'}));return;}
  if(arcadeBoardWatch)arcadeBoardWatch();
  arcadeCrownRanks.clear();arcadeBoardWatchWeek=week;
  await new Promise((resolve,reject)=>{
   arcadeBoardWatch=query.onSnapshot(snap=>{if(arcadeBoardWatchWeek===week)apply(snap);resolve();},error=>{
    arcadeCrownRanks.clear();arcadeBoardWatch=null;arcadeBoardWatchWeek=null;
    ag('gameLbBody').innerHTML='<tr><td colspan="4">Scores are unavailable. Tap Refresh to retry.</td></tr>';reject(error);
   });
  });
 }catch(e){arcadeCrownRanks.clear();ag('gameLbBody').innerHTML='<tr><td colspan="4">Scores are unavailable. Tap Refresh to retry.</td></tr>';}
 finally{arcadeBoardBusy=false;}
}

async function arcadeStartRound(){if(arcadeBusy)return;if(!arcadeUser||!arcadePlayer){arcadeMessage('Sign in or create your account to play.');ag('arcadeAuth').scrollIntoView({behavior:'smooth'});return;}arcadeBusy=true;ag('arcadeStart').disabled=true;try{const s=await arcadeCall('Start');arcadeStatus=s;arcadeOffset=s.serverNow-Date.now();if(!ag('view-game').classList.contains('active'))return;arcadeRound=s;arcadeRetryResult=null;ag('arcadeResult').textContent='';ag('arcadeScore').textContent='Score 0';arcadeEngine=createArcadeEngine(s.game,score=>{ag('arcadeScore').textContent='Score '+score;},()=>arcadeFinishRound(),s.closes);ag('arcadeEnd').disabled=false;arcadeMessage('');}catch(e){arcadeMessage(arcadeError(e));ag('arcadeStart').disabled=false;}finally{arcadeBusy=false;if(!arcadeRound)ag('arcadeStart').disabled=false;}}
let arcadeRetryResult=null;
async function arcadeFinishRound(){if(!arcadeRound||arcadeBusy)return;arcadeBusy=true;const round=arcadeRound,score=arcadeEngine?.score||0;arcadeRound=null;if(arcadeEngine)arcadeEngine.stop();arcadeEngine=null;ag('arcadeEnd').disabled=true;ag('arcadeResult').textContent='Saving round…';try{arcadeRetryResult={id:round.id,score};const result=await arcadeCall('Finish',arcadeRetryResult);arcadeRetryResult=null;ag('arcadeResult').textContent='Score '+result.score+' · +'+result.earned+' XP'+(result.highScoreBonus?' · New weekly high score! +100 XP bonus included.':'')+(result.levels?' · Level up! You earned '+result.levels+' CP Token'+(result.levels===1?'':'s')+'.':'');await arcadeLoadProfile();await renderGameLeaderboard();}catch(e){ag('arcadeResult').textContent='Save could not be confirmed. '+arcadeError(e);const retry=document.createElement('button');retry.className='nav-btn';retry.textContent='Retry save';retry.onclick=async()=>{retry.disabled=true;try{const r=await arcadeCall('Finish',arcadeRetryResult);arcadeRetryResult=null;ag('arcadeResult').textContent='Score '+r.score+' · +'+r.earned+' XP'+(r.highScoreBonus?' · New weekly high score! +100 XP bonus included.':'')+(r.levels?' · Level up! You earned '+r.levels+' CP Token'+(r.levels===1?'':'s')+'.':'');await arcadeLoadProfile();await renderGameLeaderboard();}catch(err){arcadeMessage(arcadeError(err));retry.disabled=false;}};ag('arcadeResult').append(retry);}finally{arcadeBusy=false;ag('arcadeStart').disabled=false;}}
ag('arcadeStart').onclick=arcadeStartRound;ag('arcadeEnd').onclick=arcadeFinishRound;
function stopGameLoop(){arcadeFinishRound();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)arcadeFinishRound();});
function createArcadeEngine(kind,onScore,onEnd,closes){
 if(!CHAPTER_GAMES.includes(kind))throw new Error('This game has been retired.');
 if(kind==='stack')return createChapterStack(onScore,onEnd,closes);
 const canvas=document.createElement('canvas');canvas.width=360;canvas.height=480;canvas.setAttribute('aria-label',arcadeTitles[kind]+' game area');canvas.tabIndex=0;const stage=document.createElement('div');stage.className='arcade-stage';const characterLayer=document.createElement('div');characterLayer.className='arcade-character-layer';characterLayer.setAttribute('aria-hidden','true');stage.append(canvas,characterLayer);ag('arcadeCanvasHost').replaceChildren(stage);const ctx=canvas.getContext('2d');let alive=true,raf=0,last=0,elapsed=0,score=0,acc=0;const remove=[];const api={get score(){return score;},stop(){alive=false;cancelAnimationFrame(raf);remove.forEach(f=>f());characterLayer.querySelectorAll('.arcade-character').forEach(el=>el.style.animationPlayState='paused');}};

 const crown=document.createElement('div');crown.className='arcade-crown arcade-game-crown';crown.hidden=true;crown.innerHTML=arcadeCrownSVG;characterLayer.append(crown);
 let lastCrownCheck=0,cachedCrownWeek=null;
 function drawCharacterCrown(){
  // Check the week once per second; rankings themselves update live.
  const now=arcadeNow();if(now-lastCrownCheck>1000||cachedCrownWeek===null){cachedCrownWeek=arcadeScheduleAt(now).key;lastCrownCheck=now;}
  const rank=arcadeCrownWeek===cachedCrownWeek?arcadeCrownRanks.get(arcadeUser?.uid)||0:0;
  crown.hidden=!rank;if(!rank)return;
  const cls='arcade-crown arcade-game-crown arcade-crown-'+arcadeCrownMetals[rank];if(crown.className!==cls)crown.className=cls;
  let x,y;
  if(kind==='flap'){x=70;y=bird-29;}
  else if(kind==='snake'){x=snake[0].x*20-2;y=snake[0].y*20-16;}
  else{const occupied=[];piece.forEach((r,dy)=>r.forEach((v,dx)=>{if(v)occupied.push({x:dx,y:dy});}));const top=Math.min(...occupied.map(c=>c.y)),row=occupied.filter(c=>c.y===top);x=60+(px+(Math.min(...row.map(c=>c.x))+Math.max(...row.map(c=>c.x)))/2)*24;y=(py+top)*24-17;}
  crown.style.left=(x/360*100)+'%';crown.style.top=(y/480*100)+'%';crown.style.width=(24/360*100)+'%';crown.style.height=(19/480*100)+'%';
 }
 const characterSprites=[];
 function drawCharacterSkins(){
  if(kind!=='flap')return;const equipped=arcadePlayer?.equipped;
  const skin=arcadeSkinById(equipped)?equipped:'default';
  const cells=[];
  if(kind==='flap'||skin!=='default'){
   if(kind==='flap')cells.push(['lightning','frostbite','toxic','chrome','tiger','cherryblossom','hologram','phantom'].includes(skin)?[61,bird-19,37,33.6,'bird']:[63,bird-16.8,37,33.6,'bird']);
   else if(kind==='snake')snake.forEach((p,i)=>cells.push([p.x*20+1,p.y*20+1,18,18,i===0?'head':'body']));
   else{
    board.forEach((r,y)=>r.forEach((v,x)=>{if(v)cells.push([60+x*24+1,y*24+1,22,22,'block']);}));
    piece.forEach((r,y)=>r.forEach((v,x)=>{if(v)cells.push([60+(px+x)*24+1,(py+y)*24+1,22,22,'block']);}));
   }
  }
  cells.forEach(([x,y,w,h,shape],i)=>{
   let el=characterSprites[i];
   if(!el){el=document.createElement('div');characterSprites.push(el);characterLayer.append(el);}
   const cls='arcade-character arcade-character-'+shape+' arcade-'+skin+(shape==='bird'?' '+arcadeBirdClass(skin):'');
   if(el.className!==cls){el.className=cls;el.innerHTML=shape==='bird'&&!ARCADE_ILLUSTRATED.includes(skin)?'<i class="arcade-bird-beak"></i>':'';}
   el.hidden=false;
   el.style.left=(x/360*100)+'%';el.style.top=(y/480*100)+'%';
   el.style.width=(w/360*100)+'%';el.style.height=(h/480*100)+'%';
  });
  // Keep the small sprite pool for reuse; hide any unused segments after line clears.
  for(let i=cells.length;i<characterSprites.length;i++)characterSprites[i].hidden=true;
 }
 const listen=(el,type,fn,opt)=>{el.addEventListener(type,fn,opt);remove.push(()=>el.removeEventListener(type,fn,opt));};
 const points=n=>{score+=n;onScore(score);};const end=()=>{if(!alive)return;api.stop();queueMicrotask(onEnd);};
 // Flight difficulty ramps smoothly with score, capped at 60 cleared pipes.
 const flightGapHalf=54,flightGravity=910;
 let bird=210,velocity=0,pipes=[],pipeTravel=0,flightDifficulty=0,lastGapCenter=null,lastGapDrift=0,calmPipes=0;
 function nextFlightGap(){
  const minY=90-10*flightDifficulty,maxY=390+10*flightDifficulty;
  const maxJump=280+20*flightDifficulty,driftLimit=70+25*flightDifficulty;
  if(lastGapCenter===null)return lastGapCenter=170+Math.random()*140;
  // Flow through nearby heights, with a short recovery between dramatic jumps.
  const dramatic=calmPipes>=2&&Math.random()<.18+.22*flightDifficulty;
  if(dramatic){
   const minStep=Math.min(190+25*flightDifficulty,Math.max(lastGapCenter-minY,maxY-lastGapCenter)-15);
   const ranges=[[Math.max(minY,lastGapCenter-maxJump),lastGapCenter-minStep],
                 [lastGapCenter+minStep,Math.min(maxY,lastGapCenter+maxJump)]]
     .filter(([lo,hi])=>hi>lo);
   let pick=Math.random()*ranges.reduce((sum,[lo,hi])=>sum+hi-lo,0);
   let target=ranges[ranges.length-1][1];
   for(const [lo,hi] of ranges){if(pick<hi-lo){target=lo+pick;break;}pick-=hi-lo;}
   lastGapDrift=0;calmPipes=0;
   return lastGapCenter=target;
  }
  calmPipes++;
  lastGapDrift=Math.max(-driftLimit,Math.min(driftLimit,lastGapDrift*.65+(Math.random()-.5)*(90+35*flightDifficulty)));
  let target=lastGapCenter+lastGapDrift;
  if(target<minY){target=2*minY-target;lastGapDrift=Math.abs(lastGapDrift)*.5;}
  if(target>maxY){target=2*maxY-target;lastGapDrift=-Math.abs(lastGapDrift)*.5;}
  return lastGapCenter=target;
 }

 let snake=[{x:8,y:10},{x:7,y:10},{x:6,y:10}],direction={x:1,y:0},pending=direction,turned=false,food={x:12,y:10};
 const shapes=[[[1,1,1,1]],[[1,1],[1,1]],[[0,1,0],[1,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[0,1,1],[1,1,0]],[[1,1,0],[0,1,1]]];
 let board=Array.from({length:20},()=>Array(10).fill(0)),piece=null,px=3,py=0,bag=[];
 function spawn(){if(!bag.length)bag=shapes.map(s=>s.map(r=>r.slice())).sort(()=>Math.random()-.5);piece=bag.pop();px=3;py=0;if(collides(piece,px,py))end();}
 function collides(p,x,y){return p.some((row,dy)=>row.some((v,dx)=>v&&(x+dx<0||x+dx>=10||y+dy>=20||(y+dy>=0&&board[y+dy][x+dx]))));}
 function drop(){if(!collides(piece,px,py+1)){py++;return true;}piece.forEach((r,y)=>r.forEach((v,x)=>{if(v&&py+y>=0)board[py+y][px+x]=1;}));const clean=board.filter(r=>!r.every(Boolean));points((20-clean.length)*100);while(clean.length<20)clean.unshift(Array(10).fill(0));board=clean;spawn();return false;}
 if(kind==='blocks')spawn();
 function action(a){if(!alive)return;if(kind==='flap'){velocity=-280;return;}if(kind==='snake'){const d={left:{x:-1,y:0},right:{x:1,y:0},up:{x:0,y:-1},down:{x:0,y:1}}[a];if(d&&!turned&&(d.x!==-direction.x||d.y!==-direction.y)){pending=d;turned=true;}return;}if(a==='left'||a==='right'){const x=px+(a==='left'?-1:1);if(!collides(piece,x,py))px=x;}else if(a==='up'){const rotated=piece[0].map((_,i)=>piece.map(r=>r[i]).reverse());for(const dx of [0,-1,1,-2,2])if(!collides(rotated,px+dx,py)){piece=rotated;px+=dx;break;}}else if(a==='down')drop();else if(a==='drop'){while(alive&&!collides(piece,px,py+1))py++;drop();}}
 const controls=kind==='flap'?[['flap','Tap to flap']]:kind==='blocks'?[['left','←'],['up','Rotate'],['right','→'],['down','↓'],['drop','Drop']]:[['left','←'],['up','↑'],['down','↓'],['right','→']];
 ag('arcadeControls').replaceChildren();controls.forEach(([a,label])=>{const b=document.createElement('button');b.className='nav-btn';b.textContent=label;b.setAttribute('aria-label',a==='up'&&kind==='blocks'?'Rotate':a);ag('arcadeControls').append(b);listen(b,'pointerdown',e=>{e.preventDefault();action(a);});listen(b,'click',e=>{if(e.detail===0)action(a);});});
 listen(document,'keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable)return;const a={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',' ':'drop'}[e.key];if(a){e.preventDefault();action(a);}});
 let touch=null;listen(canvas,'pointerdown',e=>{e.preventDefault();if(kind==='flap')action('flap');else{touch={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);}});listen(canvas,'pointerup',e=>{if(!touch)return;const dx=e.clientX-touch.x,dy=e.clientY-touch.y;touch=null;if(Math.max(Math.abs(dx),Math.abs(dy))<12)return;action(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');});
 function update(dt){elapsed+=dt;if(arcadeNow()>=closes||elapsed>=600){end();return;}if(kind==='flap'){flightDifficulty+=(Math.min(score/60,1)-flightDifficulty)*(1-Math.exp(-dt/2));const pipeSpeed=145+65*flightDifficulty;velocity+=flightGravity*dt;bird+=velocity*dt;pipeTravel+=pipeSpeed*dt;if(pipeTravel>=261){pipeTravel-=261;const gapCenter=nextFlightGap();pipes.push({x:380+pipeSpeed*dt-pipeTravel,gap:gapCenter,passed:false});}for(const p of pipes){p.x-=pipeSpeed*dt;if(!p.passed&&p.x+48<82){p.passed=true;points(1);}if(p.x<94&&p.x+48>70&&(bird-12<p.gap-flightGapHalf||bird+12>p.gap+flightGapHalf))end();}pipes=pipes.filter(p=>p.x>-60);if(bird<12||bird>468)end();}else if(kind==='snake'){acc+=dt;if(acc>=Math.max(.09,.17-score*.0002)){acc=0;direction=pending;turned=false;const head={x:snake[0].x+direction.x,y:snake[0].y+direction.y},eat=head.x===food.x&&head.y===food.y;if(head.x<0||head.x>=18||head.y<0||head.y>=24||snake.slice(0,eat?snake.length:-1).some(p=>p.x===head.x&&p.y===head.y)){end();return;}snake.unshift(head);if(eat){points(10);const free=[];for(let y=0;y<24;y++)for(let x=0;x<18;x++)if(!snake.some(p=>p.x===x&&p.y===y))free.push({x,y});if(!free.length){end();return;}food=free[Math.floor(Math.random()*free.length)];}else snake.pop();}}else{acc+=dt;if(acc>=Math.max(.14,.65-score/12000)){acc=0;drop();}}}
 function draw(){ctx.fillStyle='#141c2d';ctx.fillRect(0,0,360,480);if(kind==='flap'){ctx.fillStyle='#598679';for(const p of pipes){ctx.fillRect(p.x,0,48,p.gap-flightGapHalf);ctx.fillRect(p.x,p.gap+flightGapHalf,48,480);}}else if(kind==='snake'){ctx.fillStyle='#edbd61';ctx.fillRect(food.x*20+2,food.y*20+2,16,16);snake.forEach((p,i)=>{ctx.fillStyle=i?chapterSkinColor('snake'):'#e2f0e9';ctx.fillRect(p.x*20+1,p.y*20+1,18,18);});}else{ctx.strokeStyle='#ffffff0c';for(let x=0;x<=10;x++){ctx.beginPath();ctx.moveTo(60+x*24,0);ctx.lineTo(60+x*24,480);ctx.stroke();}function cell(x,y,color){ctx.fillStyle=color;ctx.fillRect(60+x*24+1,y*24+1,22,22);}board.forEach((r,y)=>r.forEach((v,x)=>{if(v)cell(x,y,chapterSkinColor('blocks'));}));piece.forEach((r,y)=>r.forEach((v,x)=>{if(v)cell(px+x,py+y,chapterSkinColor('blocks'));}));}}
 function frame(t){if(!alive)return;const dt=last?Math.min((t-last)/1000,.04):0;last=t;update(dt);draw();drawCharacterSkins();drawCharacterCrown();if(alive)raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);return api;
}
async function loadArcadeStats(){if(!isAdminLoggedIn())return;const target=ag('arcadeStatsBody');target.textContent='Loading game statistics…';try{const releaseStatus=await arcadeCall('Status');ag('chapterGameSelect').value=releaseStatus.game;ag('chapterSelectionMessage').textContent='Choose before the first round or public release. Current: '+arcadeTitles[releaseStatus.game];ag('arcadeReleaseButton').disabled=!arcadeIsAdmin||!arcadeScheduleAt(arcadeNow(),true).open||releaseStatus.released;ag('arcadeReleaseButton').textContent=releaseStatus.released?'This week’s game is open':'Open this week’s game to everyone';ag('arcadeReleaseMessage').textContent=releaseStatus.released?'Released for everyone.':'Only game admins can play until you release it. Release resets each week.';if(!arcadeUser)throw new Error('Sign in to your game-admin account in the Games tab, then return here.');const week=ag('arcadeStatsWeek').value||undefined,data=await arcadeCall('Stats',{week}),players=data.players.sort((a,b)=>b.starts-a.starts||b.seconds-a.seconds);ag('arcadeStatsWeek').value=data.week;const sum=k=>players.reduce((n,p)=>n+(p[k]||0),0);ag('arcadeMetrics').innerHTML=[['Players',players.length],['Rounds started',sum('starts')],['Rounds completed',sum('completed')],['Minutes played',Math.round(sum('seconds')/60)]].map(([label,n])=>'<div class="arcade-metric"><strong>'+n+'</strong>'+label+'</div>').join('');ag('arcadeStatsLeaders').textContent=players.length?'Most rounds: '+players[0].name+' ('+players[0].starts+'). Most time: '+[...players].sort((a,b)=>b.seconds-a.seconds)[0].name+'.':'';target.innerHTML=players.length?'<div class="arcade-table-scroll"><table class="lb-table"><thead><tr><th>Player</th><th>Starts</th><th>Finished</th><th>Minutes</th><th>Best</th><th>Avg score</th></tr></thead><tbody>'+players.map(p=>'<tr><td>'+arcadeNameHTML(p.name,p.equipped)+'</td><td>'+p.starts+'</td><td>'+p.completed+'</td><td>'+(p.seconds/60).toFixed(1)+'</td><td>'+p.best+'</td><td>'+ (p.completed?Math.round(p.totalScore/p.completed):'—')+'</td></tr>').join('')+'</tbody></table></div>':'No play recorded for this week.';;if(players.length){
 const heading=document.createElement('th');heading.textContent='Award XP';target.querySelector('thead tr').append(heading);
 const removeHeading=document.createElement('th');removeHeading.textContent='Moderation';target.querySelector('thead tr').append(removeHeading);
 const removalHelp=document.createElement('p');removalHelp.className='arcade-note';removalHelp.textContent='Remove score clears the selected week’s leaderboard entry and saved best. Any active round for that week is canceled. XP, tokens, skins and play counts stay. Available before weekly rewards are finalized.';target.append(removalHelp);
 target.querySelectorAll('tbody tr').forEach((row,i)=>{
  const player=players[i],cell=document.createElement('td'),form=document.createElement('form'),input=document.createElement('input'),button=document.createElement('button'),status=document.createElement('div');
  input.type='number';input.min='1';input.max='100000';input.step='1';input.required=true;input.placeholder='XP amount';input.style.width='110px';input.setAttribute('aria-label','XP to award to '+player.name);
  button.type='submit';button.className='nav-btn';button.textContent='Add XP';status.setAttribute('role','status');
  const storageKey='arcadeXPAward:'+arcadeUser.uid+':'+player.id;
  let pending=null;try{pending=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch(e){}
  if(pending){input.value=pending.amount;input.disabled=true;button.textContent='Retry award';status.textContent='A previous award needs confirmation. Retry will not add it twice.';}
  form.onsubmit=async e=>{
   e.preventDefault();if(button.disabled||!form.reportValidity())return;
   pending=pending||{uid:player.id,amount:Number(input.value),requestId:crypto.randomUUID()};
   button.disabled=true;input.disabled=true;status.textContent='Adding XP…';
   try{
    sessionStorage.setItem(storageKey,JSON.stringify(pending));
    const result=await arcadeCall('AwardXP',pending);
    pending=null;sessionStorage.removeItem(storageKey);input.value='';
    status.textContent='Added '+result.amount+' XP to '+player.name+' · Lifetime XP: '+result.afterXP;
    if(player.id===arcadeUser.uid)arcadeLoadProfile().catch(()=>{});
   }catch(error){status.textContent=(String(error.code||'').includes('permission-denied')?'Firebase blocked this award. Publish the admin XP rules addition, then retry.':arcadeError(error))+' Retry checks the same award without adding it twice.';}
   finally{button.disabled=false;input.disabled=!!pending;button.textContent=pending?'Retry award':'Add XP';}
  };
  form.append(input,button,status);cell.append(form);row.append(cell);
  const removeCell=document.createElement('td'),removeButton=document.createElement('button'),removeStatus=document.createElement('div');
  removeButton.type='button';removeButton.className='nav-btn';removeButton.textContent='Remove score';removeButton.setAttribute('aria-label','Remove '+player.name+'’s score for week of '+data.week);removeStatus.setAttribute('role','status');removeStatus.style.maxWidth='240px';
  const removalKey='arcadeScoreRemoval:'+arcadeUser.uid+':'+data.week+':'+player.id;
  let removalPending=null;try{removalPending=JSON.parse(sessionStorage.getItem(removalKey)||'null');}catch(e){}
  if(removalPending){removeButton.textContent='Retry removal';removeStatus.textContent='Check the same removal without clearing a new score.';}
  if(data.finalized){removeButton.disabled=true;removeStatus.textContent='Rewards finalized';}
  else if(!removalPending&&!(player.best>0)){removeButton.disabled=true;removeStatus.textContent='No score to remove';}
  removeButton.onclick=async()=>{
   if(removeButton.disabled)return;
   if(!removalPending&&!confirm('Remove '+player.name+'’s score for the week of '+data.week+'? This clears the saved best and cancels any active round for that week. Their account, XP, tokens and skins stay.'))return;
   removalPending=removalPending||{uid:player.id,week:data.week,requestId:crypto.randomUUID()};
   removeButton.disabled=true;removeStatus.textContent='Removing score…';
   try{
    try{sessionStorage.setItem(removalKey,JSON.stringify(removalPending));}catch(e){}
    const removed=await arcadeCall('RemoveScore',removalPending);removalPending=null;try{sessionStorage.removeItem(removalKey);}catch(e){}
    removeStatus.textContent='Removed '+removed.removedScore+' points for '+removed.week+'.';removeButton.textContent='Score removed';
    // A retried receipt may predate a legitimate new score. Read the current
    // saved best instead of incorrectly displaying zero after that retry.
    try{const current=await arcadeStatsRef(String(Date.parse(data.week+'T00:00:00Z')),player.id).get({source:'server'});player.best=current.exists?current.data().best||0:0;row.querySelectorAll('td')[4].textContent=String(player.best);if(player.best>0){removeButton.textContent='Remove score';removeButton.disabled=false;removeStatus.textContent+=' Current saved best: '+player.best+'.';}}catch(e){removeStatus.textContent+=' Refresh statistics to see the current best.';}
    renderGameLeaderboard().catch(()=>{});if(player.id===arcadeUser?.uid)arcadeLoadProfile().catch(()=>{});
   }catch(error){removeStatus.textContent=arcadeError(error)+' Retry checks the same removal.';removeButton.disabled=false;removeButton.textContent='Retry removal';}
  };
  removeCell.append(removeButton,removeStatus);row.append(removeCell);
 });
}}catch(e){ag('arcadeMetrics').replaceChildren();ag('arcadeStatsLeaders').textContent='';target.textContent=arcadeError(e);}}


// Weekly selection, separate inventories, permanent results and avatar rewards.
const chapterInventoryRef=(uid,game)=>arcadeProfileRef(uid).collection('gameSkins').doc(game);
const chapterDefaultInventory=()=>({owned:['default'],equipped:'default'});
function chapterActiveGame(){return arcadeStatus?.game||arcadeScheduleAt(arcadeNow()).game;}
function chapterSkin(game,id){return CHAPTER_SKINS[game]?.find(s=>s.id===id);}
function chapterGameSkin(game){return game==='flap'?arcadePlayer?.equipped||'default':chapterInventory[game]?.equipped||'default';}
function chapterSkinColor(game){return chapterSkin(game,chapterGameSkin(game))?.color||({stack:'#67e8f9',blocks:'#60a5fa',snake:'#4ade80'}[game])||'#38bdf8';}
function chapterUseCatalog(game){if(!CHAPTER_SKINS[game])return;setArcadeSkins(CHAPTER_SKINS[game]);arcadeColorIds=['default',...FLIGHT_SKINS.map(s=>s.id),...Object.values(CHAPTER_SKINS).flat().map(s=>s.id)];arcadeBuildWheel();const title=ag('chapterExploreLabel');if(title)title.textContent='Explore '+ARCADE_SKINS.length+' '+arcadeTitles[game]+' skins & odds';}
async function chapterReadSelection(){const w=arcadeScheduleAt(arcadeNow()),key=w.key;const refs=['sparkArcadeSelections','sparkArcadeLocks','sparkArcadeReleases','sparkArcadeRecords'];const snaps=await Promise.all(refs.map(c=>c==='sparkArcadeRecords'&&!arcadeAuth.currentUser?Promise.resolve({exists:false}):arcadeStore.collection(c).doc(key).get({source:'server'})));const legacy=['flap','blocks','snake'][((Math.floor((Number(key)-Date.UTC(2026,8,7))/604800000)%3)+3)%3];chapterSelections[key]=snaps[0].exists?snaps[0].data().game:snaps[1].exists?snaps[1].data().game:(snaps[2].exists||snaps[3].exists)?legacy:null;}
function chapterWatchSelection(){const s=arcadeScheduleAt(arcadeNow());if(chapterSelectionWeek===s.key)return;if(chapterSelectionWatch)chapterSelectionWatch();chapterSelectionWeek=s.key;chapterSelectionWatch=arcadeStore.collection('sparkArcadeSelections').doc(s.key).onSnapshot(snap=>{if(snap.metadata.fromCache)return;if(snap.exists)chapterSelections[s.key]=snap.data().game;arcadeStatus=arcadeScheduleAt(arcadeNow(),arcadeIsAdmin);chapterUseCatalog(arcadeStatus.game);arcadeRenderSchedule();if(arcadePlayer)arcadeRenderProfile();},e=>{chapterSelectionWeek=null;arcadeMessage(arcadeError(e));});}
async function chapterSelectGame(){const button=ag('chapterSelectButton');button.disabled=true;try{await chapterReadSelection();const uid=arcadeUid();if(!await arcadeCheckAdmin(uid))throw new Error('Sign in to your game-admin account first.');const s=arcadeScheduleAt(arcadeNow(),true),game=ag('chapterGameSelect').value;if(!s.open)throw new Error('Choose the new challenge from Sunday, Central Time. An in-progress retired game cannot be switched into a different game’s scores.');await arcadeStore.runTransaction(async tx=>{const ref=arcadeStore.collection('sparkArcadeSelections').doc(s.key),lock=await tx.get(arcadeStore.collection('sparkArcadeLocks').doc(s.key)),release=await tx.get(arcadeStore.collection('sparkArcadeReleases').doc(s.key)),record=await tx.get(arcadeStore.collection('sparkArcadeRecords').doc(s.key));if(lock.exists||release.exists||record.exists)throw new Error('This week is already in progress. Game selection locks on the first round or public release. Choose again next Sunday.');tx.set(ref,{game,chosenBy:uid,updated:arcadeStamp()});});chapterSelections[s.key]=game;arcadeStatus=arcadeScheduleAt(arcadeNow(),true);chapterUseCatalog(game);arcadeRenderSchedule();arcadeRenderProfile();ag('chapterSelectionMessage').textContent=arcadeTitles[game]+' selected for this week.';}catch(e){ag('chapterSelectionMessage').textContent=arcadeError(e);}finally{button.disabled=false;}}
async function chapterLoadInventory(){if(!arcadeUser)return;const uid=arcadeUser.uid;const snap=await chapterInventoryRef(uid,'stack').get({source:'server'}),wallet=await arcadeStore.collection('sparkArcadePiWallets').doc(uid).get({source:'server'});if(arcadeUser?.uid!==uid)return;chapterInventory.stack=snap.exists?snap.data():chapterDefaultInventory();chapterPiBalance=wallet.exists?wallet.data().balance:0;}

function chapterRenderCollection(){const game=chapterCollectionGame,active=chapterActiveGame(),inventory=game==='flap'?{owned:arcadePlayer?.owned||['default'],equipped:arcadePlayer?.equipped||'default'}:chapterInventory[game]||chapterDefaultInventory();ag('chapterCollectionTabs').innerHTML=CHAPTER_GAMES.map(g=>'<button type="button" class="nav-btn" data-collection="'+g+'" aria-pressed="'+(game===g)+'">'+arcadeTitles[g]+'</button>').join('');ag('chapterCollectionNote').textContent=game===active?'Active game · Choose an owned skin to equip.':'Collection preview · Equipping and wheel rewards return when this game is selected.';ag('arcadeColors').innerHTML=inventory.owned.filter(id=>id==='default'||chapterSkin(game,id)).map(id=>'<button type="button" class="nav-btn" data-color="'+id+'" '+(game!==active?'disabled ':'')+'aria-pressed="'+(inventory.equipped===id)+'">'+(game==='flap'?chapterFlightBirdHTML(id,'arcade-collection-bird'):'<span class="chapter-skin-preview chapter-'+game+'" style="--skin-color:'+(chapterSkin(game,id)?.color||'#94a3b8')+'"></span>')+'<span>'+escapeHtml(chapterSkin(game,id)?.label||'Default')+'</span></button>').join('');}
function chapterRenderAccount(){if(!arcadePlayer)return;ag('arcadePlayerAvatar').innerHTML=chapterFlightBirdHTML(arcadePlayer.equipped);ag('chapterPiBalance').textContent=chapterPiBalance+' Pi tokens';chapterRenderCollection();const mine=chapterResults.filter(r=>r.winners.some(p=>p.uid===arcadeUser?.uid&&p.rank===1));ag('chapterTrophies').innerHTML=mine.length?mine.map(r=>'<div class="chapter-trophy">'+arcadeCrownHTML(1)+'<strong>'+escapeHtml(arcadeTitles[r.game]||r.game)+'</strong><span>Week of '+escapeHtml(r.week)+'</span><small>1st place · '+r.winners[0].score+' points</small></div>').join(''):'<p class="arcade-note">Finish first at Friday’s cutoff to earn a permanent crown showing the game and week.</p>';ag('chapterLiveCrown').innerHTML=arcadeCurrentCrownRank()===1?arcadeCrownHTML(1)+' Leading '+escapeHtml(arcadeTitles[chapterActiveGame()])+' · Week of '+arcadeScheduleAt(arcadeNow()).week+' (in progress)':'';}

async function chapterClaimReward(week,recipient=arcadeUid()){const ref=arcadeStore.collection('sparkArcadePiWallets').doc(recipient),receipt=ref.collection('awards').doc(week);return arcadeStore.runTransaction(async tx=>{const old=await tx.get(receipt);if(old.exists)return false;const result=await tx.get(arcadeStore.collection('sparkArcadeResults').doc(week));if(!result.exists||result.data().rewardVersion!==2)return false;const placement=result.data().winners.find(w=>w.uid===recipient);if(!placement)return false;const snap=await tx.get(ref),balance=snap.exists?snap.data().balance:0;tx.set(ref,{balance:balance+chapterPiReward(placement.rank),lastAward:week,updated:arcadeStamp()});tx.set(receipt,{amount:chapterPiReward(placement.rank),rank:placement.rank,awardedAt:arcadeStamp()});return true;});}
async function chapterCreditWeek(key,result){if(result.rewardVersion!==2)return;for(const p of result.winners)await chapterClaimReward(key,p.uid);}
function chapterPiReward(rank){return rank<1||rank>20?0:rank===1?100:rank===2?80:rank===3?60:40-2*(rank-4);}
function chapterRewardCountdown(){const el=ag('chapterRewardCountdown');if(!el)return;const w=arcadeScheduleAt(arcadeNow()),left=Math.max(0,w.closes-arcadeNow());if(!left){el.textContent='Friday cutoff reached · Rankings locked. Pi tokens are credited after admin finalization.';return;}const days=Math.floor(left/86400000),hours=Math.floor(left/3600000)%24,minutes=Math.floor(left/60000)%60,seconds=Math.floor(left/1000)%60;el.textContent='Friday 11:59 PM CT · '+days+'d '+hours+'h '+minutes+'m '+seconds+'s remaining · Rewards are projected until the cutoff.';}
async function chapterFinalizeWeek(key){if(!await arcadeCheckAdmin(arcadeUid()))throw new Error('A game admin must finalize results.');const ms=Number(key),close=arcadeMidnight(ms+5*86400000);if(!Number.isSafeInteger(ms)||arcadeNow()<close)throw new Error('The Friday cutoff has not passed.');const resultRef=arcadeStore.collection('sparkArcadeResults').doc(key),old=await resultRef.get({source:'server'});if(old.exists){await chapterCreditWeek(key,old.data());return false;}const release=await arcadeStore.collection('sparkArcadeReleases').doc(key).get({source:'server'});if(!release.exists)throw new Error('An unreleased preview week cannot award trophies.');const selection=await arcadeStore.collection('sparkArcadeSelections').doc(key).get({source:'server'}),lock=await arcadeStore.collection('sparkArcadeLocks').doc(key).get({source:'server'});const game=selection.exists?selection.data().game:lock.exists?lock.data().game:['flap','blocks','snake'][((Math.floor((ms-Date.UTC(2026,8,7))/604800000)%3)+3)%3];const top=await arcadeStore.collection('sparkArcadeBoards').doc(key).collection('players').where('score','>',0).orderBy('score','desc').orderBy(firebase.firestore.FieldPath.documentId(),'desc').limit(20).get({source:'server'});const winners=top.docs.map((d,i)=>({uid:d.id,name:d.data().name,score:d.data().score,rank:i+1,points:chapterPiReward(i+1)}));const result={week:new Date(ms).toISOString().slice(0,10),weekMillis:ms,game,winners,uids:winners.map(w=>w.uid),rewardVersion:2,championUid:winners[0]?.uid||'',finalizedBy:arcadeUid(),finalizedAt:arcadeStamp()};await arcadeStore.runTransaction(async tx=>{const exists=await tx.get(resultRef);if(exists.exists)return;for(const d of top.docs){const fresh=await tx.get(d.ref);if(!fresh.exists||fresh.data().score!==d.data().score)throw new Error('Results changed. Retry finalization.');}tx.set(resultRef,result);});await chapterCreditWeek(key,(await resultRef.get({source:'server'})).data());return true;}
async function chapterFinalizePending(){const button=ag('chapterFinalizeButton');button.disabled=true;try{if(!await arcadeCheckAdmin(arcadeUid()))throw new Error('Sign in to your game-admin account first.');let last=null,count=0;do{let q=arcadeStore.collection('sparkArcadeReleases').orderBy(firebase.firestore.FieldPath.documentId()).limit(100);if(last)q=q.startAfter(last);const batch=await q.get({source:'server'});for(const d of batch.docs)if(arcadeNow()>=arcadeMidnight(Number(d.id)+5*86400000))count+=await chapterFinalizeWeek(d.id)?1:0;last=batch.size===100?batch.docs.at(-1):null;}while(last);ag('chapterFinalizeMessage').textContent=count+' completed weeks finalized. Results and Pi token payouts are ready.';await chapterLoadResults();}catch(e){ag('chapterFinalizeMessage').textContent=arcadeError(e);}finally{button.disabled=false;}}
async function chapterLoadResults(){let all=[],last=null;do{let q=arcadeStore.collection('sparkArcadeResults').orderBy('weekMillis','desc').limit(100);if(last)q=q.startAfter(last);const snap=await q.get({source:'server'});all.push(...snap.docs.map(d=>({key:d.id,...d.data()})));last=snap.size===100?snap.docs.at(-1):null;}while(last);chapterResults=all;chapterWins=new Map();for(const r of all){const w=r.winners[0];if(!w)continue;const row=chapterWins.get(w.uid)||{uid:w.uid,name:w.name,wins:0,weeks:[]};row.wins++;row.weeks.push(r);chapterWins.set(w.uid,row);}const leaders=[...chapterWins.values()].sort((a,b)=>b.wins-a.wins||a.name.localeCompare(b.name));ag('chapterChampions').innerHTML=leaders.length?leaders.map((p,i)=>'<div class="chapter-champion"><strong>#'+(i+1)+' '+escapeHtml(p.name)+'</strong><span>👑 '+p.wins+' weekly win'+(p.wins===1?'':'s')+'</span><small>'+p.weeks.map(r=>escapeHtml(r.week)+' · '+escapeHtml(arcadeTitles[r.game])).join('<br>')+'</small></div>').join(''):'<p class="arcade-note">The first champion will appear after a released week ends and its results are finalized.</p>';ag('chapterResultsHistory').innerHTML=all.map(r=>'<details><summary>'+escapeHtml(r.week)+' · '+escapeHtml(arcadeTitles[r.game])+'</summary>'+r.winners.map(w=>'<p>'+w.rank+'. '+escapeHtml(w.name)+' · '+w.score+' score · '+w.points+(r.rewardVersion===2?' Pi tokens':' legacy points')+'</p>').join('')+'</details>').join('');if(arcadeUser){for(const r of all)if(r.rewardVersion===2&&r.winners.some(w=>w.uid===arcadeUser.uid))await chapterClaimReward(r.key);await chapterLoadInventory();}if(arcadePlayer)chapterRenderAccount();if(arcadeCrownWeek)renderGameLeaderboard();}
async function chapterLoadExtras(){if(chapterExtrasBusy)return;chapterExtrasBusy=true;try{await chapterLoadResults();if(arcadeUser&&await arcadeCheckAdmin(arcadeUser.uid))await chapterFinalizePending();}catch(e){ag('chapterChampions').textContent='Results could not be loaded. '+arcadeError(e);}finally{chapterExtrasBusy=false;}}
function chapterFlightBirdHTML(id,extra=''){const skin=FLIGHT_SKINS.find(s=>s.id===id)?id:'default';return '<span class="arcade-character-bird arcade-bird-art arcade-'+skin+' '+extra+'" aria-hidden="true"></span>';}
// Original Stack-style timing game: alternate axes, trim overhang, and build upward.
function chapterStackOverlap(base,moving,axis){const lo=Math.max(base[axis],moving[axis]),hi=Math.min(base[axis]+base[axis==='x'?'w':'d'],moving[axis]+moving[axis==='x'?'w':'d']);return {lo,size:Math.max(0,hi-lo),perfect:Math.abs(base[axis]-moving[axis])<=3};}
function createChapterStack(onScore,onEnd,closes){const canvas=document.createElement('canvas');canvas.width=360;canvas.height=480;canvas.tabIndex=0;canvas.setAttribute('aria-label','Stack Tower. Tap or press Space to place the moving block.');const stage=document.createElement('div');stage.className='arcade-stage';stage.append(canvas);ag('arcadeCanvasHost').replaceChildren(stage);const ctx=canvas.getContext('2d');let alive=true,raf=0,last=0,elapsed=0,score=0,axis='x',dir=1,streak=0,camera=0,lastDrop=-1,flash='',flashTime=0;let tower=[{x:-65,z:-65,w:130,d:130}],moving={x:-205,z:-65,w:130,d:130};const events=[],fragments=[];const api={get score(){return score},stop(){alive=false;cancelAnimationFrame(raf);events.forEach(([el,t,f])=>el.removeEventListener(t,f));}};const listen=(el,t,f)=>{el.addEventListener(t,f);events.push([el,t,f])};const end=()=>{if(!alive)return;api.stop();queueMicrotask(onEnd)};
 function place(){if(!alive||elapsed-lastDrop<.22)return;lastDrop=elapsed;const base=tower.at(-1),a=axis==='x'?'x':'z',dim=axis==='x'?'w':'d',hit=chapterStackOverlap(base,moving,a==='z'?'z':'x');if(hit.size<=0){flash='Missed!';draw();end();return;}if(hit.perfect){moving[a]=base[a];streak++;flash='Perfect'+(streak>1?' ×'+streak:'');}else{const cut=moving[dim]-hit.size,edge=moving[a]<base[a]?moving[a]:hit.lo+hit.size;fragments.push({...moving,[a]:edge,[dim]:cut,level:tower.length,fall:0});moving[a]=hit.lo;moving[dim]=hit.size;streak=0;flash='Keep stacking';}flashTime=1;score++;onScore(score);tower.push({...moving});axis=axis==='x'?'z':'x';moving={...moving};const nextAxis=axis==='x'?'x':'z';dir=score%2?1:-1;moving[nextAxis]=dir===1?-205:205-moving[axis==='x'?'w':'d'];}
 function polygon(points,color){ctx.fillStyle=color;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fill();ctx.strokeStyle='rgba(255,255,255,.22)';ctx.stroke();}
 function block(b,level,fall=0){const project=(x,z,y)=>[180+(x-z)*.68,380+(x+z)*.29-y*12+camera+fall];const a=project(b.x,b.z,level),c=project(b.x+b.w,b.z,level),d=project(b.x+b.w,b.z+b.d,level),e=project(b.x,b.z+b.d,level);const down=p=>[p[0],p[1]+12],col=chapterSkinColor('stack');polygon([e,d,down(d),down(e)],col);ctx.globalAlpha=.55;polygon([c,d,down(d),down(c)],col);ctx.globalAlpha=1;polygon([a,c,d,e],col);ctx.fillStyle='rgba(255,255,255,.15)';ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...c);ctx.lineTo(...d);ctx.lineTo(...e);ctx.closePath();ctx.fill();}
 function draw(){const bg=ctx.createLinearGradient(0,0,0,480);bg.addColorStop(0,'#10223a');bg.addColorStop(1,'#060c16');ctx.fillStyle=bg;ctx.fillRect(0,0,360,480);tower.forEach((b,i)=>{if(i>=tower.length-28)block(b,i)});fragments.forEach(b=>block(b,b.level,b.fall));block(moving,tower.length);ctx.textAlign='center';ctx.fillStyle='#f8fafc';ctx.font='bold 32px system-ui';ctx.fillText(score,180,53);ctx.font='14px system-ui';ctx.fillStyle='#a5bed8';ctx.fillText(flashTime>0?flash:'Tap to place · Space / Enter',180,79);}
 function frame(t){if(!alive)return;const dt=Math.min(.04,(t-last)/1000||0);last=t;elapsed+=dt;if(arcadeNow()>=closes||elapsed>=600){end();return;}const speed=90+Math.min(210,score*4),a=axis==='x'?'x':'z',dim=axis==='x'?'w':'d';moving[a]+=dir*speed*dt;if(moving[a]>205-moving[dim]){moving[a]=205-moving[dim];dir=-1}if(moving[a]<-205){moving[a]=-205;dir=1}camera+=(Math.max(0,(tower.length-12)*12)-camera)*Math.min(1,dt*6);flashTime-=dt;fragments.forEach(f=>f.fall+=250*dt);while(fragments.length&&fragments[0].fall>700)fragments.shift();draw();raf=requestAnimationFrame(frame);}
 ag('arcadeControls').replaceChildren();const button=document.createElement('button');button.className='primary-btn';button.textContent='Place block';ag('arcadeControls').append(button);listen(button,'pointerdown',e=>{e.preventDefault();place()});listen(button,'click',e=>{if(e.detail===0)place()});listen(canvas,'pointerdown',e=>{e.preventDefault();place()});listen(document,'keydown',e=>{if(e.repeat||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.target.isContentEditable)return;if(e.code==='Space'||e.code==='Enter'){e.preventDefault();place()}});raf=requestAnimationFrame(frame);return api;}

ag('chapterCollectionTabs').onclick=e=>{const b=e.target.closest('[data-collection]');if(b){chapterCollectionGame=b.dataset.collection;chapterRenderCollection();}};
ag('chapterSelectButton').onclick=chapterSelectGame;
ag('chapterFinalizeButton').onclick=chapterFinalizePending;
ag('chapterRefreshWinners').onclick=()=>chapterLoadResults().catch(e=>arcadeMessage(arcadeError(e)));

setInterval(()=>{if(ag('view-game').classList.contains('active'))chapterRewardCountdown();},1000);
chapterRewardCountdown();

// blackjack.js writes the pi balance. ES modules forbid assigning to an
// imported binding, so the write goes through a setter that lives in the
// module that owns the variable.
export function setChapterPiBalance(n) { chapterPiBalance = n; }

export {
  initGameView, stopGameLoop, renderGameLeaderboard, loadArcadeStats,
  arcadeReleaseCurrentWeek,
  // consumed by blackjack.js
  ag, arcadeAuth, arcadeStore, arcadeStamp, arcadeUid, arcadeMessage,
  arcadePlayer, arcadeRound, arcadeBusy, chapterPiBalance,
};
