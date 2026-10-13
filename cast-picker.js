let castSelection=[];
function bindCastPicker() {
 const host=$("#cast-picker");
 castSelection=(state.filters.castPeople || []).slice(0,3);
 let version=0,timer;
 host.innerHTML='<div class="cast-selected"></div><input id="cast-search" type="search" maxlength="200" placeholder="Search a name…" autocomplete="off" aria-describedby="cast-hint"><p id="cast-hint" class="muted">Choose up to 3 people. Matches ranked by TMDB popularity.</p><div class="cast-results" aria-live="polite"></div><label for="cast-match">Include movies starring</label><select id="cast-match"><option value="any">Any selected person</option><option value="all">All selected people together</option></select>';
 const input=host.querySelector("#cast-search"),results=host.querySelector(".cast-results");
 host.querySelector("#cast-match").value=state.filters.castMatch || "any";
 function draw() {
  host.querySelector(".cast-selected").innerHTML=castSelection.map(person=>`<button type="button" class="cast-chip" data-remove-person="${person.id}" aria-label="Remove ${esc(person.name)}">${esc(person.name)} <span aria-hidden="true">×</span></button>`).join("");
  input.disabled=castSelection.length>=3;
  input.placeholder=input.disabled ? "Three people selected" : "Search a name…";
  host.querySelectorAll("[data-remove-person]").forEach(button=>button.onclick=()=>{version++;clearTimeout(timer);castSelection=castSelection.filter(person=>person.id!==Number(button.dataset.removePerson));results.innerHTML="";draw();});
 }
 draw();
 input.onkeydown=event=>{if(event.key==="Enter")event.preventDefault();};
 input.oninput=()=>{
  clearTimeout(timer);const request=++version,query=input.value.trim();results.innerHTML="";
  if(query.length<2)return;
  timer=setTimeout(async()=>{
   if(!host.isConnected || request!==version)return;
   results.textContent="Finding people…";
   try {
    const data=await tmdb("search/person",{query,include_adult:false,page:1});
    if(!host.isConnected || request!==version)return;
    const people=(data.results || []).filter(person=>Number.isSafeInteger(person.id) && !person.adult && person.known_for_department==="Acting" && !castSelection.some(selected=>selected.id===person.id)).sort((a,b)=>(Number(b.popularity)||0)-(Number(a.popularity)||0)).slice(0,10);
    results.innerHTML=people.length ? people.map(person=>`<button class="cast-result" type="button" data-person="${person.id}">${person.profile_path ? `<img src="${esc(image(person.profile_path))}" alt="" loading="lazy">` : '<span class="cast-avatar" aria-hidden="true"></span>'}<span><strong>${esc(person.name)}</strong><small>${esc((person.known_for || []).map(movie=>movie.title || movie.name).filter(Boolean).slice(0,2).join(" · "))}</small></span></button>`).join("") : '<p class="muted">No matching actors found. Try another name.</p>';
    results.querySelectorAll("[data-person]").forEach(button=>button.onclick=()=>{
     if(castSelection.length>=3)return;
     const person=people.find(person=>person.id===Number(button.dataset.person));
     if(!person || castSelection.some(selected=>selected.id===person.id))return;
     castSelection.push({id:person.id,name:person.name});version++;input.value="";results.innerHTML="";draw();
    });
   }catch(error){if(host.isConnected && request===version)results.textContent=error.message || "Could not search people. Try again.";}
  },350);
 };
}
