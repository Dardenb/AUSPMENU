// Entry point. Vite inlines the CSS in this order, matching the order the five
// <style> blocks appeared in the original single-file version.
import './styles/base.css';
import './styles/skins.css';
import './styles/arcade.css';
import './styles/stack.css';
import './styles/blackjack.css';

import * as meals from './meals.js';
import * as arcade from './arcade.js';
import './blackjack.js';   // self-wiring: attaches its own listeners on load

// ── Navigation ────────────────────────────────────────────────────────────
// showView lives here rather than in meals.js because it is the one function
// that touches both halves of the app.
const views = ['menu', 'leaderboard', 'qr', 'admin', 'game'];

function showView(v) {
  views.forEach(id => {
    document.getElementById('view-' + id).classList.toggle('active', id === v);
  });
  document.querySelectorAll('.top-nav .nav-btn').forEach((b, i) => {
    if (views[i]) b.classList.toggle('active', views[i] === v);
  });
  if (v === 'menu') meals.renderMenu();
  if (v === 'leaderboard') meals.renderLeaderboard(meals.currentLbFilter, document.querySelector('.lb-filter.active'));
  if (v === 'admin') meals.renderAdminInit();
  if (v === 'game') { arcade.initGameView(); } else { arcade.stopGameLoop(); }
}

// meals.js emits these instead of calling the arcade directly.
meals.onMealsEvent('cloudUpdate', () => arcade.renderGameLeaderboard());
meals.onMealsEvent('gameStats', () => arcade.loadArcadeStats());

// ── Inline on* attributes ─────────────────────────────────────────────────
// The markup still uses onclick="switchDay(0)". Module scope is not global, so
// every function named in an on* attribute has to be republished here.
// Delete an entry only when you have also removed it from the markup.
Object.assign(window, {
  showView,
  switchDay: meals.switchDay,
  toggleDay: meals.toggleDay,
  rateMeal: meals.rateMeal,
  toggleComments: meals.toggleComments,
  postComment: meals.postComment,
  voteComment: meals.voteComment,
  renderLeaderboard: meals.renderLeaderboard,
  adminLogin: meals.adminLogin,
  adminLogout: meals.adminLogout,
  switchAdminTab: meals.switchAdminTab,
  loadEditorWeek: meals.loadEditorWeek,
  saveWeekMeals: meals.saveWeekMeals,
  handleItemSelect: meals.handleItemSelect,
  createCatalogItem: meals.createCatalogItem,
  deleteCatalogItem: meals.deleteCatalogItem,
  changePassword: meals.changePassword,
  clearRatings: meals.clearRatings,
  generateQR: meals.generateQR,
  downloadQR: meals.downloadQR,
  initGameView: arcade.initGameView,
  renderGameLeaderboard: arcade.renderGameLeaderboard,
  loadArcadeStats: arcade.loadArcadeStats,
  arcadeReleaseCurrentWeek: arcade.arcadeReleaseCurrentWeek,
});
