/* Telegram Mini App: same app inside a Telegram bot */
(function(){
  const inTG=/tgWebApp/.test(location.hash+location.search)||!!window.TelegramWebviewProxy;
  if(inTG)document.documentElement.classList.add("tg");
  window.__tgReady=function(){
    const tg=window.Telegram&&Telegram.WebApp;if(!tg||!tg.initData&&!inTG)return;
    try{tg.ready();tg.expand();if(tg.disableVerticalSwipes)tg.disableVerticalSwipes()}catch(e){}
    const paint=()=>{try{const bg=getComputedStyle(document.body).backgroundColor;tg.setHeaderColor(bg);tg.setBackgroundColor(bg);if(tg.setBottomBarColor)tg.setBottomBarColor(bg)}catch(e){}};
    if(S.settings.theme==="system"){document.documentElement.setAttribute("data-theme",tg.colorScheme==="dark"?"dark":"light");tg.onEvent("themeChanged",()=>{if(S.settings.theme==="system"){document.documentElement.setAttribute("data-theme",tg.colorScheme==="dark"?"dark":"light");paint()}})}
    paint();new MutationObserver(paint).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme","data-accent"]});
    const back=()=>{if(ui.view!=="overview"){tg.BackButton.show()}else tg.BackButton.hide()};
    tg.BackButton.onClick(()=>{if($("#qs").classList.contains("open"))closeQS();else location.hash="#overview"});
    addEventListener("hashchange",back);back();
    document.addEventListener("click",e=>{const el=e.target.closest("[data-a]");if(!el)return;const a=el.dataset.a;try{if(a==="hab"||a==="task-done")tg.HapticFeedback.impactOccurred("light");else if(a==="qs-chip"||a==="qs")tg.HapticFeedback.selectionChanged()}catch(e){}},true);
    document.addEventListener("submit",e=>{if(e.target.dataset.f==="qs")try{tg.HapticFeedback.notificationOccurred("success")}catch(err){}},true);
  };
  if(window.Telegram&&Telegram.WebApp)window.__tgReady();
})();
