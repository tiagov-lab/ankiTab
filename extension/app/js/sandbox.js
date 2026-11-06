window.addEventListener('message', async function(event) {
    switch(event.data.command) {
    case 'render':
        window.mutex = new Promise((resolve, reject)=>{
          var html = event.data.html;
          document.body.querySelector(".flashcard").innerHTML = html;
          // Run scripts (setting innerHTML doesn't run any)
          var scripts = Array.prototype.slice.call(document.body.querySelector(".flashcard").getElementsByTagName("script"));
          for (var i = 0; i < scripts.length; i++) {
            if (scripts[i].src != "") {
              var tag = document.createElement("script");
              tag.src = scripts[i].src;
              document.getElementsByTagName("head")[0].appendChild(tag);
            }
            else {
              // Firefox has no manifest sandbox, so extension CSP blocks eval there;
              // don't let a card script abort rendering/media loading
              try {
                eval(scripts[i].innerHTML);
              } catch (e) {
                console.warn('AnkiTab: could not run card script', e);
              }
            }
          }
          resolve();
          typeset();
        });
        break;
    case 'replaceMedia':
        await window.mutex;
        document.querySelectorAll(`[src="${decodeURI(event.data.oldSrc)}"]`).forEach(async (elem)=>{
          elem.src = event.data.newSrc
        });
    }
})

function typeset(){
  try{
    MathJax.Hub.Typeset();
  } catch(e){
    setTimeout(typeset, 300);
  }
}
