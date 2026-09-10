import { db } from './firebase.js';

// main.js registers the arcade's callbacks here, so this module never imports
// the arcade and the dependency graph stays one-directional.
const hooks = { cloudUpdate: [], gameStats: [] };
export function onMealsEvent(name, fn) { hooks[name].push(fn); }
function emit(name) { hooks[name].forEach(fn => fn()); }
export function isAdminLoggedIn() { return adminLoggedIn; }

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const MEALS = ['Breakfast','Lunch','Dinner'];

let cloudData = { weeks: {}, catalog: [], ratings: {}, password: 'chef1234' };
let initialLoad = true;
let currentLbFilter = 'all';

db.ref('/').on('value', (snapshot) => {
  if (snapshot.exists()) {
    cloudData = snapshot.val();
    if (!cloudData.weeks) cloudData.weeks = {};
    if (!cloudData.catalog) cloudData.catalog = [];
    if (!cloudData.ratings) cloudData.ratings = {};
    if (!cloudData.gameScores) cloudData.gameScores = {};
  } else if (initialLoad) {
    seedIfEmptyFirebase();
  }
  
  initialLoad = false;
  
  if (document.getElementById('view-menu').classList.contains('active')) renderMenu();
  if (document.getElementById('view-leaderboard').classList.contains('active')) renderLeaderboard(currentLbFilter);
  if (document.getElementById('view-game').classList.contains('active')) emit('cloudUpdate');
  
  if (adminLoggedIn) {
    if (document.getElementById('tab-editor').style.display === 'block') loadEditorWeek();
    if (document.getElementById('tab-items').style.display === 'block') renderCatalog();
  }
});

// ══════════════════════════════════════════
//  FIREBASE CLOUD DATA LAYER
// ══════════════════════════════════════════
function getPassword() { return cloudData.password || 'chef1234'; }
function setPassword(p) { db.ref('password').set(p); }

// TIMEZONE FIX - Formatting strictly in local time instead of UTC to avoid date shifting
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const dateNum = String(d.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${dateNum}`;
}

function currentWeekKey() { return getMonday(new Date()); }
function getMeals(weekKey) { return cloudData.weeks[weekKey] || null; }
function setMeals(weekKey, meals) { db.ref('weeks/' + weekKey).set(meals); }
function getCatalog() { return cloudData.catalog || []; }
function saveCatalog(c) { db.ref('catalog').set(c); }
function mealKey(name) { return name.trim().toLowerCase().replace(/[.#$\[\]]/g, ""); }
function getItemStore() { return cloudData.ratings || {}; }

function getItemRatings(name) {
  return cloudData.ratings[mealKey(name)]?.ratings || [];
}

function addItemRating(name, type, stars) {
  const k = mealKey(name);
  const currentItem = cloudData.ratings[k] || { name, type, ratings: [] };
  let currentRatings = currentItem.ratings || [];
  currentRatings.push(stars);
  
  db.ref('ratings/' + k).update({ 
    name: name, 
    type: type, 
    ratings: currentRatings 
  });
}

function updateItemRating(name, oldStars, newStars) {
  const k = mealKey(name);
  if (!cloudData.ratings[k]) { addItemRating(name, '', newStars); return; }
  let currentRatings = cloudData.ratings[k].ratings || [];
  const idx = currentRatings.indexOf(oldStars);
  if (idx !== -1) currentRatings[idx] = newStars;
  else currentRatings.push(newStars); 
  
  db.ref('ratings/' + k + '/ratings').set(currentRatings);
}

function getMyRatingStore() {
  try { return JSON.parse(localStorage.getItem('chefMyRatings') || '{}'); } catch { return {}; }
}
function getMyRating(name) { return getMyRatingStore()[mealKey(name)] || 0; }
function setMyRating(name, stars) {
  const r = getMyRatingStore();
  r[mealKey(name)] = stars;
  localStorage.setItem('chefMyRatings', JSON.stringify(r));
}

// ══════════════════════════════════════════
//  COMMENTS & VOTING LOGIC
// ══════════════════════════════════════════
function toggleComments(id) {
  const drawer = document.getElementById('drawer-' + id);
  drawer.classList.toggle('active');
}

function postComment(mealName, uiId) {
  const input = document.getElementById('input-' + uiId);
  const text = input.value.trim();
  if (!text) return;

  const k = mealKey(mealName);
  const commentData = {
    text: text,
    ts: Date.now(),
    votes: 0
  };

  db.ref('ratings/' + k + '/comments').push(commentData)
    .then(() => {
      input.value = '';
      showToast('Comment posted!');
    })
    .catch(() => showToast('Error posting comment.'));
}

function voteComment(mealName, commentId, change) {
  let voted = JSON.parse(localStorage.getItem('chefVotedComments') || '[]');
  if(voted.includes(commentId)) {
     showToast('You already voted on this comment');
     return;
  }
  voted.push(commentId);
  localStorage.setItem('chefVotedComments', JSON.stringify(voted));
  
  const k = mealKey(mealName);
  const ref = db.ref(`ratings/${k}/comments/${commentId}/votes`);
  ref.transaction((currentVotes) => {
    return (currentVotes || 0) + change;
  });
}

let activeDay = 0;
let currentMenuWeek = null;

function formatWeekLabel(weekKey) {
  const start = new Date(weekKey + 'T12:00:00');
  const end = new Date(start); end.setDate(end.getDate() + 4);
  const fmt = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  return `${fmt(start)} – ${fmt(end)}, ${start.getFullYear()}`;
}

function renderMenu() {
  currentMenuWeek = currentWeekKey();
  const meals = getMeals(currentMenuWeek);
  
  if(!meals) {
     document.getElementById('mealsContainer').innerHTML = `<div class="empty-state">
      <div class="icon">🍽️</div>
      <h3>No meals this week yet</h3>
      <p>Check back soon or ask the admin to add this week's menu.</p>
    </div>`;
  }

  document.getElementById('hero-week-label').textContent = formatWeekLabel(currentMenuWeek);

  const tabs = document.getElementById('dayTabs');
  const dayDates = DAYS.map((_, i) => {
    const d = new Date(currentMenuWeek + 'T12:00:00');
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  });
  tabs.innerHTML = DAYS.map((day, i) =>
    `<div class="day-tab ${i===activeDay?'active':''}" onclick="switchDay(${i})">
      ${day.slice(0,3)} <span class="day-date">${dayDates[i]}</span>
    </div>`
  ).join('');

  renderDayMeals(meals);
}

function switchDay(i) {
  activeDay = i;
  renderMenu();
}

function renderDayMeals(meals) {
  const container = document.getElementById('mealsContainer');
  if (!meals || !meals[activeDay] || !meals[activeDay].some(m => m.name)) {
    container.innerHTML = `<div class="empty-state">
      <div class="icon">🍽️</div>
      <h3>No meals planned</h3>
      <p>Check back soon — the chef hasn't added ${DAYS[activeDay]}'s menu yet.</p>
    </div>`;
    return;
  }

  const dayMeals = meals[activeDay];
  container.innerHTML = dayMeals.map((meal, mealIdx) => {
    if (!meal.name) return '';
    const k = mealKey(meal.name);
    
    // Fetch ratings AND comments
    const itemData = cloudData.ratings?.[k] || {};
    const ratings = itemData.ratings || [];
    const comments = itemData.comments || {};
    
    // Convert to array and sort by votes first, then timestamp
    const commentList = Object.entries(comments)
      .map(([id, c]) => ({ id, ...c }))
      .sort((a,b) => (b.votes || 0) - (a.votes || 0) || b.ts - a.ts);

    const avg = ratings.length ? (ratings.reduce((a,b)=>a+b,0)/ratings.length) : 0;
    const myRating = getMyRating(meal.name);
    const starSvg = `<svg viewBox="0 0 12 12"><path d="M6 1l1.3 2.6L10 4l-2 1.9.5 2.7L6 7.4l-2.5 1.2.5-2.7L2 4l2.7-.4z"/></svg>`;

    return `<div class="meal-section">
      <div class="meal-time-label">${meal.type}</div>
      <div class="meal-card">
        <div class="meal-card-top">
          <div class="meal-name">${meal.name}</div>
          ${ratings.length ? `<div class="meal-avg">${starSvg}${avg.toFixed(1)}</div>` : ''}
        </div>
        ${meal.desc ? `<div class="meal-desc">${meal.desc}</div>` : ''}
        
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="stars-row" id="stars-${activeDay}-${mealIdx}">
            ${[1,2,3,4,5].map(s =>
              `<button class="star-btn ${myRating>=s?'lit rated':''}" onclick="rateMeal(${activeDay},${mealIdx},${s})" aria-label="${s} star">★</button>`
            ).join('')}
            <span class="rating-count">${ratings.length} rating${ratings.length!==1?'s':''}</span>
          </div>
          
          <button class="comment-toggle" onclick="toggleComments('${k}-${mealIdx}')">
            💬 <span style="font-size:12px">${commentList.length}</span>
          </button>
        </div>

        <div class="comment-drawer" id="drawer-${k}-${mealIdx}">
          <div class="comment-list">
            ${commentList.map(c => `
              <div class="comment-item">
                ${c.text}
                <div class="comment-meta">
                  <span class="comment-date">${new Date(c.ts).toLocaleDateString()}</span>
                  <div class="comment-actions">
                    <button class="vote-btn" onclick="voteComment('${meal.name.replace(/'/g, "\\'")}', '${c.id}', 1)">▲ <span class="vote-count">${c.votes || 0}</span></button>
                    <button class="vote-btn" onclick="voteComment('${meal.name.replace(/'/g, "\\'")}', '${c.id}', -1)">▼</button>
                  </div>
                </div>
              </div>
            `).join('') || '<p style="font-size:11px; color:var(--ink-muted); text-align:center;">No comments yet.</p>'}
          </div>
          <div class="comment-input-row">
            <input type="text" class="comment-input" id="input-${k}-${mealIdx}" placeholder="Add a comment..." onkeydown="if(event.key==='Enter')postComment('${meal.name.replace(/'/g, "\\'")}', '${k}-${mealIdx}')">
            <button class="send-btn" onclick="postComment('${meal.name.replace(/'/g, "\\'")}', '${k}-${mealIdx}')">➔</button>
          </div>
        </div>
        
        ${myRating ? `<div class="rated-badge">✓ You rated this ${myRating} star${myRating!==1?'s':''}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function rateMeal(dayIdx, mealIdx, stars) {
  const meals = getMeals(currentMenuWeek);
  const meal = meals[dayIdx][mealIdx];
  const prev = getMyRating(meal.name);
  if (prev) {
    updateItemRating(meal.name, prev, stars);
  } else {
    addItemRating(meal.name, meal.type, stars);
  }
  setMyRating(meal.name, stars);
  showToast('Rating saved to the cloud!');
}

let qrInstance = null;
function generateQR() {
  const url = document.getElementById('qrUrlInput').value.trim();
  if (!url) { showToast('Please enter a URL first'); return; }
  const box = document.getElementById('qrcode');
  box.innerHTML = '';
  qrInstance = new QRCode(box, {
    text: url, width: 220, height: 220,
    colorDark: '#1A1612', colorLight: '#FFFDF9',
    correctLevel: QRCode.CorrectLevel.H
  });
  document.getElementById('qrUrlDisplay').textContent = url;
  document.getElementById('qrUrlDisplay').style.display = 'block';
  document.getElementById('dlBtn').style.display = 'block';
}

function downloadQR() {
  const canvas = document.querySelector('#qrcode canvas');
  if (!canvas) { showToast('Generate a QR code first'); return; }
  const link = document.createElement('a');
  link.download = 'chef-menu-qr.png';
  link.href = canvas.toDataURL();
  link.click();
}

let adminLoggedIn = false;

function renderAdminInit() {
  document.getElementById('adminLogin').style.display = adminLoggedIn ? 'none' : 'block';
  document.getElementById('adminDash').style.display = adminLoggedIn ? 'block' : 'none';
  if (adminLoggedIn) {
    document.getElementById('weekStartInput').value = getMonday(new Date());
    loadEditorWeek();
  }
}

function adminLogin() {
  const pass = document.getElementById('adminPass').value;
  if (pass === getPassword()) {
    adminLoggedIn = true;
    document.getElementById('loginErr').textContent = '';
    document.getElementById('adminPass').value = '';
    renderAdminInit();
  } else {
    document.getElementById('loginErr').textContent = 'Incorrect password.';
  }
}

function adminLogout() {
  adminLoggedIn = false;
  renderAdminInit();
}

function switchAdminTab(name, btn) {
  ['editor','items','settings','gameStats'].forEach(t => {
    document.getElementById('tab-'+t).style.display = t===name?'block':'none';
  });
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (name === 'items') renderCatalog();
  if (name === 'editor') loadEditorWeek();
  if (name === 'gameStats') emit('gameStats');
}

function createCatalogItem() {
  const name = document.getElementById('newItemName').value.trim();
  const desc = document.getElementById('newItemDesc').value.trim();
  if(!name) { showToast('Item name is required'); return; }
  
  const cat = getCatalog();
  if(cat.find(c => mealKey(c.name) === mealKey(name))) {
    showToast('An item with this name already exists'); return;
  }
  
  cat.push({ name, desc });
  saveCatalog(cat);
  
  document.getElementById('newItemName').value = '';
  document.getElementById('newItemDesc').value = '';
  showToast('Item added to cloud catalog');
}

function deleteCatalogItem(name) {
  if(!confirm('Are you sure you want to remove this item? (Previous menus keep their data)')) return;
  let cat = getCatalog();
  cat = cat.filter(c => c.name !== name);
  saveCatalog(cat);
}

function renderCatalog() {
  const tbody = document.getElementById('catalogBody');
  const cat = getCatalog();
  if(cat.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--ink-muted);font-size:13px;">No items created yet. Add a dish above!</td></tr>`;
    return;
  }
  tbody.innerHTML = cat.map(c => `
    <tr>
      <td style="font-weight:500;">${c.name}</td>
      <td style="color:var(--ink-muted); font-size: 13px;">${c.desc || '—'}</td>
      <td style="text-align:right;">
        <button class="nav-btn" style="padding:4px 8px;font-size:11px;" onclick="deleteCatalogItem('${c.name.replace(/'/g, "\\'")}')">Remove</button>
      </td>
    </tr>
  `).join('');
}

function loadEditorWeek() {
  const weekKey = getMonday(new Date(document.getElementById('weekStartInput').value + 'T12:00:00'));
  const saved = getMeals(weekKey) || DAYS.map(() => MEALS.map(t => ({ type: t, name: '', desc: '' })));
  const catalog = getCatalog();
  
  const wrap = document.getElementById('dayEditors');
  wrap.innerHTML = DAYS.map((day, di) => {
    const dayDate = new Date(weekKey + 'T12:00:00');
    dayDate.setDate(dayDate.getDate() + di);
    const dateStr = dayDate.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    return `<div class="day-editor">
      <div class="day-editor-header" onclick="toggleDay(${di})">
        <span>${day} <span style="font-weight:300;color:var(--ink-muted);font-size:13px;">${dateStr}</span></span>
        <span style="color:var(--ink-muted);font-size:13px;" id="daychev-${di}">▾</span>
      </div>
      <div class="day-editor-body" id="daybody-${di}">
        ${MEALS.map((type, mi) => {
          const m = saved[di]?.[mi] || { type, name: '', desc: '' };
          
          let options = `<option value="">-- No Meal Assigned --</option>`;
          let foundInCatalog = false;
          
          catalog.forEach(c => {
            const isSelected = m.name === c.name ? 'selected' : '';
            if(isSelected) foundInCatalog = true;
            options += `<option value="${c.name.replace(/"/g, '&quot;')}" ${isSelected}>${c.name}</option>`;
          });
          
          if (m.name && !foundInCatalog) {
             options += `<option value="${m.name.replace(/"/g, '&quot;')}" selected>${m.name} (Legacy Item)</option>`;
          }

          return `<div class="meal-row">
            <div class="meal-row-type">${type}</div>
            <div class="meal-row-fields">
              <select class="inline-input" id="meal-${di}-${mi}-name" onchange="handleItemSelect(${di}, ${mi}, this.value)">
                ${options}
              </select>
              <input class="inline-input" id="meal-${di}-${mi}-desc" placeholder="Description (optional)" value="${m.desc||''}" />
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
  wrap.dataset.weekKey = weekKey;
}

function handleItemSelect(di, mi, val) {
  if(!val) return;
  const cat = getCatalog();
  const item = cat.find(c => c.name === val);
  if(item && item.desc) {
    const descInput = document.getElementById(`meal-${di}-${mi}-desc`);
    if(!descInput.value.trim()) {
      descInput.value = item.desc;
    }
  }
}

function toggleDay(di) {
  const body = document.getElementById('daybody-'+di);
  const chev = document.getElementById('daychev-'+di);
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? 'flex' : 'none';
  chev.textContent = hidden ? '▾' : '▸';
}

function saveWeekMeals() {
  const weekKey = document.getElementById('dayEditors').dataset.weekKey;
  if (!weekKey) return;
  const meals = DAYS.map((_, di) =>
    MEALS.map((type, mi) => ({
      type,
      name: document.getElementById(`meal-${di}-${mi}-name`)?.value?.trim() || '',
      desc: document.getElementById(`meal-${di}-${mi}-desc`)?.value?.trim() || '',
    }))
  );
  setMeals(weekKey, meals);
  const msg = document.getElementById('saveMsg');
  msg.style.display = 'inline';
  setTimeout(() => { msg.style.display = 'none'; }, 2500);
  showToast('Menu saved to cloud!');
}

function renderLeaderboard(filter, btn) {
  currentLbFilter = filter || currentLbFilter;
  if (btn) {
    document.querySelectorAll('#view-leaderboard .lb-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  const store = getItemStore();
  const allMeals = Object.values(store)
    .filter(v => v.ratings && v.ratings.length > 0)
    .filter(v => currentLbFilter === 'all' || v.type === currentLbFilter)
    .map(v => {
      const avg = v.ratings.reduce((a,b)=>a+b,0) / v.ratings.length;
      return { name: v.name, type: v.type, avg, count: v.ratings.length };
    })
    .sort((a,b) => b.avg - a.avg || b.count - a.count);

  const starSvg = `<svg viewBox="0 0 12 12"><path d="M6 1l1.3 2.6L10 4l-2 1.9.5 2.7L6 7.4l-2.5 1.2.5-2.7L2 4l2.7-.4z"/></svg>`;
  const tbody = document.getElementById('lbBody');

  if (allMeals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--ink-muted);font-size:13px;">No rated meals yet. Add a menu and collect ratings!</td></tr>`;
    return;
  }

  tbody.innerHTML = allMeals.map((m, i) => `
    <tr>
      <td class="lb-rank ${i<3?'top':''}">${i+1}</td>
      <td>
        <div class="lb-meal-name">${m.name}</div>
        <div class="lb-meal-meta">${m.type}</div>
      </td>
      <td><div class="lb-avg">${starSvg}${m.avg.toFixed(1)}</div></td>
      <td class="lb-count">${m.count}</td>
    </tr>`).join('');
}

function changePassword() {
  const cur = document.getElementById('curPass').value;
  const nw = document.getElementById('newPass').value;
  const conf = document.getElementById('confPass').value;
  const msg = document.getElementById('passMsg');
  if (cur !== getPassword()) { msg.textContent = 'Current password is incorrect.'; return; }
  if (nw.length < 4) { msg.textContent = 'New password must be at least 4 characters.'; return; }
  if (nw !== conf) { msg.textContent = 'Passwords do not match.'; return; }
  setPassword(nw);
  msg.style.color = 'var(--sage)';
  msg.textContent = '✓ Password updated!';
  document.getElementById('curPass').value = '';
  document.getElementById('newPass').value = '';
  document.getElementById('confPass').value = '';
  setTimeout(() => { msg.textContent = ''; msg.style.color = ''; }, 3000);
}

function clearRatings() {
  if (!confirm('Are you sure? This will delete all collected ratings from the cloud permanently.')) return;
  db.ref('ratings').remove();
  localStorage.removeItem('chefMyRatings');
  localStorage.removeItem('chefVotedComments');
  showToast('All cloud ratings cleared.');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ══════════════════════════════════════════
//  INITIAL CLOUD SEEDING (Only runs if DB is empty)
// ══════════════════════════════════════════
function seedIfEmptyFirebase() {
  const weekKey = currentWeekKey();
  const sample = [
    [['Avocado Toast & Eggs','Multigrain toast, smashed avocado, poached eggs'],['Grilled Chicken Salad','Mixed greens, cherry tomatoes, lemon vinaigrette'],['Beef Stir-Fry','Tenderloin, bok choy, jasmine rice']],
    [['Greek Yogurt Parfait','Honey, granola, fresh berries'],['Turkey & Avocado Wrap','Whole wheat tortilla, swiss, spinach'],['Salmon & Roasted Veg','Atlantic salmon, asparagus, lemon butter']],
    [['Oatmeal & Fruit Bowl','Steel-cut oats, banana, walnuts, maple syrup'],['Tomato Basil Soup','Roasted tomato, fresh basil, garlic bread'],['Pasta Primavera','Penne, seasonal vegetables, parmesan']],
    [['Veggie Omelette','Spinach, mushroom, feta, whole wheat toast'],['Quinoa Power Bowl','Roasted chickpeas, cucumber, tahini'],['Pork Tenderloin','Apple glaze, mashed sweet potato, green beans']],
    [['Banana Pancakes','Fluffy stacks, maple syrup, fresh fruit'],['Caesar Salad & Shrimp','Romaine, croutons, parmesan, grilled shrimp'],['Fish Tacos','Crispy cod, slaw, chipotle aioli, corn tortillas']],
  ];

  const meals = sample.map(day => MEALS.map((type, i) => ({ type, name: day[i][0], desc: day[i][1] })));
  db.ref('weeks/' + weekKey).set(meals);

  const cat = [];
  sample.forEach(day => day.forEach(meal => { if(!cat.find(c => c.name === meal[0])) cat.push({ name: meal[0], desc: meal[1] }); }));
  db.ref('catalog').set(cat);

  const demoRatings = {
    'Avocado Toast & Eggs':    { type: 'Breakfast', ratings: [4,5,5,4] },
    'Grilled Chicken Salad':   { type: 'Lunch',     ratings: [3,4,5]   },
    'Beef Stir-Fry':           { type: 'Dinner',    ratings: [5,5,4,5] },
    'Pasta Primavera':         { type: 'Dinner',    ratings: [4,4,5,3] },
    'Fish Tacos':              { type: 'Dinner',    ratings: [5,5,5,4] },
  };
  
  const formattedRatings = {};
  Object.entries(demoRatings).forEach(([name, v]) => {
    formattedRatings[mealKey(name)] = { name, type: v.type, ratings: v.ratings };
  });
  
  db.ref('ratings').set(formattedRatings);
  db.ref('password').set('chef1234');
}


export {
  DAYS, MEALS, cloudData, currentLbFilter,
  renderMenu, renderLeaderboard, renderAdminInit,
  showToast, getMonday, currentWeekKey, mealKey,
  // handlers referenced by inline on* attributes
  switchDay, toggleDay, rateMeal, toggleComments, postComment, voteComment,
  adminLogin, adminLogout, switchAdminTab, loadEditorWeek, saveWeekMeals,
  handleItemSelect, createCatalogItem, deleteCatalogItem, changePassword,
  clearRatings, generateQR, downloadQR,
};
