import rotateDeck from "./extended/rotateDeck.js"
import MIME from "./mimeTypes.js"
import ankiConnectInvoke from "../../libs/ankiConnect.js"

let card;

function getCurrentCard(){
	return card;
}

function getCard(){
	return ankiConnectInvoke("guiCurrentCard")
		.then(res=>{
			if(typeof res.question !== "string"){
				res.question = res.question[0];
			}
			card = res;
			/*ankiConnectInvoke("getIntervals", {cards: [res.cardId], complete:true}).then(res=>{
				card.intervals=processIntervals(res);
			});*/
		}, (e)=>{
			return new Promise((resolve, reject)=>{
				chrome.storage.local.get(["lastDeck", "emptyDecks"], function(result) {
					result.emptyDecks.push({name: result.lastDeck, date:Date.now()});
					chrome.storage.local.set({emptyDecks: result.emptyDecks}, ()=>
						rotateDeck().then(getCard).then(resolve)
					);
				});
			});
		});
}

function processIntervals(interv){
	return interv.map((u)=>{
		if(u<=0)
			return -u+'s';
		else
			return u+'d';
	});
}

function replaceAudioTags(html) {
	return html.replace(/\[sound:([^\]]*)\]/g, (match, filename) => {
		let mediaType = "audio";
		let extension = '.' + filename.split('.').pop();
		let mimeType = (MIME[extension] || "").split('/')[0];
		if (mimeType == "video")
			mediaType = "video";
		return '<' + mediaType + ' controls src="' + filename + '"></' + mediaType + '>';
	});
}

function buildCardHTML(css, content){
	return "<style>"+css+"</style>"+replaceAudioTags(content);
}

function decodeBase64Utf8(b64){
	return new TextDecoder().decode(Uint8Array.from(atob(b64), (c)=>c.charCodeAt(0)));
}

// Card templates often load helpers from Anki's media folder (<script src="_mc.js">).
// Those files only exist inside Anki, so fetch them through AnkiConnect and inline them.
async function inlineMediaScripts(html){
	const tpl=document.createElement("template");
	tpl.innerHTML=html;
	const scripts=Array.from(tpl.content.querySelectorAll("script[src]"));
	await Promise.all(scripts.map(async (script)=>{
		const src=script.getAttribute("src");
		if(/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) return; // remote URL, leave it
		try{
			const data=await ankiConnectInvoke("retrieveMediaFile", {filename: decodeURIComponent(src.split(/[?#]/)[0])});
			if(data){
				script.removeAttribute("src");
				script.textContent=decodeBase64Utf8(data);
			}
		}catch(e){
			console.warn("AnkiTab: could not load media script", src, e);
		}
	}));
	return tpl.innerHTML;
}

let renderSeq=0;

async function renderInSandbox(content){
	const seq=++renderSeq;
	const html=await inlineMediaScripts(buildCardHTML(getCurrentCard().css, content));
	if(seq!==renderSeq) return; // a newer render (e.g. the answer) started meanwhile
	// Build the card under an invisible <div> too, which makes it easy to find
	// the media that has to be fetched from AnkiConnect.
	document.querySelector("#flashcard").innerHTML=html;
	// Render it in the sandbox, where the card's JavaScript runs.
	document.querySelector("#flashcardSandbox").contentWindow.postMessage({
		'command': 'render', 'html': html
	}, '*');
	retrieveMedia();
}

function retrieveMedia(){
	document.querySelector("#flashcard").querySelectorAll("[src]:not(script)").forEach((elem)=>{
		let filename=elem.src.split('/').pop()
		let fileExtension='.'+filename.split('.').pop()
		ankiConnectInvoke("retrieveMediaFile", {filename:decodeURIComponent(filename)}).then((data)=>{
      let newSrc = "data:"+MIME[fileExtension]+";base64,"+data;
      document.querySelector("#flashcardSandbox").contentWindow.postMessage({
        'command': 'replaceMedia', 'oldSrc': filename, newSrc
      }, '*');
    })
	});
}


function renderQuestion(){
	renderInSandbox(getCurrentCard().question);
	document.querySelector("#deckName").innerText=getCurrentCard().deckName;
	//Buttons
	document.querySelector("#answerButtons").innerHTML='<button class="btn btn-primary btn-lg" id="showAnswerButton" title="Space">Show Answer</button>';
	document.querySelector("#showAnswerButton").addEventListener('click', ()=>renderAnswer());
	//document.querySelector("#flashcardParent").className="card card"+(getCurrentCard()[cardType]+1);
	//reviewStartTime=getTime();
	document.addEventListener('keyup', keyboardShowAnswer);
}

function keyboardShowAnswer(e){
	(e.which == 32 || e.which==13) && renderAnswer();
}

function renderAnswer(){
	document.removeEventListener('keyup', keyboardShowAnswer);
	renderInSandbox(getCurrentCard().answer);
	//Buttons
	document.querySelector("#answerButtons").innerHTML='';
	let intervals=getCurrentCard().buttons;
	let btnNames=["Again", "Good"]
	if(intervals.length>=3){
		btnNames.push("Easy");
	}
	if(intervals.length>=4){
		btnNames.splice(1, 0, "Hard");
	}
	btnNames.forEach((btn, i)=>{
		document.querySelector("#answerButtons").innerHTML+='<div><span class="interval"></span><button class="btn btn-secondary btn-lg" id="btn'+i+'">'+btn+'</button></div>';
	});
	btnNames.forEach((btn, i)=>{
		document.querySelector("#btn"+i).addEventListener('click', ()=>answerQuestion(i+1));
	});
	document.addEventListener('keyup', keyboardAnswer);
	ankiConnectInvoke("guiShowAnswer");
}

function keyboardAnswer(e){
	let num=Number(e.key);
	if(Number.isInteger(num) && num<=getCurrentCard().buttons.length && num>0){
		answerQuestion(num);
	}
}


function answerQuestion(answer){
	document.removeEventListener('keyup', keyboardAnswer);
	renderSeq++;
	document.querySelector("#flashcard").innerHTML='';
	document.querySelector("#flashcardSandbox").contentWindow.postMessage({
		'command': 'render', 'html': document.querySelector("#flashcard").innerHTML
	}, '*');
	retrieveMedia();
	document.querySelector("#deckName").innerText='';
	ankiConnectInvoke("guiAnswerCard", {ease:answer}).then(()=>{
		rotateDeck().then(getCard).then(renderQuestion);
	});
}

function start(){
	rotateDeck().then(getCard).then(renderQuestion);
}

export default start;
