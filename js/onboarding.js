/* ===========================================================
   Onboarding — shows the animated hand-role overlay once per
   browser (localStorage flag), with a manual "replay" option.
=========================================================== */
const Onboarding = (function(){
  let el = null;

  function init(){
    el = document.getElementById('onboarding');
    document.getElementById('onboardingSkip').addEventListener('click', hide);
  }

  function hasSeenBefore(){
    try {
      return localStorage.getItem(CONFIG.ONBOARDING_STORAGE_KEY) === '1';
    } catch(e){
      return false; // if storage blocked, just show it each time rather than error
    }
  }

  function markSeen(){
    try {
      localStorage.setItem(CONFIG.ONBOARDING_STORAGE_KEY, '1');
    } catch(e){ /* ignore */ }
  }

  function showIfFirstTime(){
    if (!hasSeenBefore()) show();
  }

  function show(){
    if (!el) return;
    el.classList.add('show');
  }

  function hide(){
    if (!el) return;
    el.classList.remove('show');
    markSeen();
  }

  return { init, showIfFirstTime, show, hide };
})();
