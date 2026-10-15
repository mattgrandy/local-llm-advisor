(function(){var r=document.documentElement,k="llma-theme",s=null;try{s=localStorage.getItem(k)}catch(e){}
var u=(location.search.match(/[?&]theme=(dark|light)/)||[])[1];var t=u||s||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");r.setAttribute("data-theme",t);
document.addEventListener("DOMContentLoaded",function(){var b=document.getElementById("theme-toggle");if(!b)return;
function sync(){var c=r.getAttribute("data-theme");b.setAttribute("aria-label","Switch to "+(c==="dark"?"light":"dark")+" theme");b.setAttribute("aria-pressed",c==="light")}
sync();b.addEventListener("click",function(){var n=r.getAttribute("data-theme")==="dark"?"light":"dark";r.setAttribute("data-theme",n);try{localStorage.setItem(k,n)}catch(e){}sync()});
document.addEventListener("click",function(e){var c=e.target.closest&&e.target.closest("button.copy");if(!c)return;var el=document.getElementById(c.dataset.c);if(!el)return;
var done=function(){c.classList.add("done");c.textContent="Copied";setTimeout(function(){c.classList.remove("done");c.textContent="Copy"},1400)};
var fb=function(){try{var t=document.createElement("textarea");t.value=el.textContent;t.setAttribute("readonly","");t.style.cssText="position:fixed;top:0;left:0;opacity:0";document.body.appendChild(t);t.select();var ok=document.execCommand("copy");document.body.removeChild(t);if(ok){done();return}}catch(x){}c.textContent="Press Ctrl+C";var rg=document.createRange();rg.selectNodeContents(el);var sl=getSelection();sl.removeAllRanges();sl.addRange(rg);setTimeout(function(){c.textContent="Copy"},1800)};
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(el.textContent).then(done,fb);else fb();});});})();
