(function(){var r=document.documentElement,k="llma-theme",s=null;try{s=localStorage.getItem(k)}catch(e){}
var u=(location.search.match(/[?&]theme=(dark|light)/)||[])[1];var t=u||s||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");r.setAttribute("data-theme",t);
document.addEventListener("DOMContentLoaded",function(){var b=document.getElementById("theme-toggle");if(!b)return;
function sync(){var c=r.getAttribute("data-theme");b.setAttribute("aria-label","Switch to "+(c==="dark"?"light":"dark")+" theme");b.setAttribute("aria-pressed",c==="light")}
sync();b.addEventListener("click",function(){var n=r.getAttribute("data-theme")==="dark"?"light":"dark";r.setAttribute("data-theme",n);try{localStorage.setItem(k,n)}catch(e){}sync()});
document.addEventListener("click",function(e){var c=e.target.closest&&e.target.closest("button.copy");if(!c)return;var el=document.getElementById(c.dataset.c);if(!el)return;
var done=function(){c.classList.add("done");c.textContent="Copied";setTimeout(function(){c.classList.remove("done");c.textContent="Copy"},1400)};
if(navigator.clipboard)navigator.clipboard.writeText(el.textContent).then(done,function(){});});});})();
