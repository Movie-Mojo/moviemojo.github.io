function canRateMovie(entry) { return !!(entry.watched || entry.dnf || state.completedMovies?.includes(entry.movies.id)); }
function personalRatingPanel(entry) {
 if(!canRateMovie(entry)) return "";
 return `<section class="personal-rating" data-rating-movie="${esc(entry.movies.id)}"><p>Your rating <small>Only yours · across your watchlists</small></p><div class="rating-stars" role="group" aria-label="Your personal star rating"></div><button type="button" class="link-button clear-rating">Clear rating</button><span class="rating-feedback" role="status"></span></section>`;
}
function bindPersonalRating(entry) {
 const host=modal.querySelector(".personal-rating");
 if(!host)return;
 const movieId=entry.movies.id, userId=state.user.id;
 function draw() {
  const stars=state.personalRatings[movieId] || 0;
  host.querySelector(".rating-stars").innerHTML=[1,2,3,4,5].map(value=>`<button type="button" data-stars="${value}" aria-label="Rate ${value} ${value===1 ? "star" : "stars"}" aria-pressed="${stars===value}" class="rating-star ${value<=stars ? "filled" : ""}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/></svg></button>`).join("");
  host.querySelector(".clear-rating").hidden=!stars;
 }
 draw();
 host.onclick=event=>{
  const button=event.target.closest("[data-stars],.clear-rating");
  if(!button || host.dataset.saving)return;
  run(button,async()=>{
   host.dataset.saving="true";
   host.querySelectorAll("button").forEach(control=>control.disabled=true);
   try {
    if(button.matches(".clear-rating")) {
     checked(await db.from("movie_ratings").delete().eq("user_id",userId).eq("movie_id",movieId));
     if(state.user?.id===userId)delete state.personalRatings[movieId];
    } else {
     const stars=Number(button.dataset.stars),values={stars,updated_at:new Date().toISOString()};
     const existing=checked(await db.from("movie_ratings").select("stars").eq("user_id",userId).eq("movie_id",movieId).limit(1));
     if(existing.length) {
      const rows=checked(await db.from("movie_ratings").update(values).eq("user_id",userId).eq("movie_id",movieId).select("movie_id"));
      if(!rows.length)throw Error("Your rating could not be saved.");
     } else {
      const result=await db.from("movie_ratings").insert({user_id:userId,movie_id:movieId,...values});
      if(result.error?.code==="23505") checked(await db.from("movie_ratings").update(values).eq("user_id",userId).eq("movie_id",movieId));
      else checked(result);
     }
     if(state.user?.id===userId)state.personalRatings[movieId]=stars;
    }
    if(state.tab==="watchlist")watchlist();
    if(state.profileHistory) {
      for(const movie of [...(state.profileHistory.movies || []),...(state.profileHistory.excluded || [])]) if(movie.id===movieId) movie.personal_rating=state.personalRatings[movieId] || null;
      if(state.tab==="profile")renderProfileHistory();
    }
    if(host.isConnected)host.querySelector(".rating-feedback").textContent="Saved for you.";
   } finally {
    delete host.dataset.saving;
    if(host.isConnected){draw();host.querySelectorAll("button").forEach(control=>control.disabled=false);}
   }
  });
 };
}
async function setDnf(entry,value) {
 const rows=checked(await db.from("group_movies").update({dnf:value,dnf_at:value ? new Date().toISOString() : null,watched:false,watched_at:null}).eq("id",entry.id).select("id"));
 if(!rows.length)throw Error("This movie could not be updated. Refresh and try again.");
 state.profileHistory=null;
 await loadMovies();render();toast(value ? "Marked did not finish for this group." : "Moved back to your watchlist.");
}

function completionDialog(entry,completion) {
 const label=completion==="dnf" ? "Did not finish" : "Mark watched";
 const current=state.personalRatings[entry.movies.id];
 let stars=null;
 openModal(`<h2>${label}</h2><p class="muted">${esc(entry.movies.title)} · Applies to everyone in this group.</p><section class="personal-rating"><p>Your rating <small>Optional · only yours</small></p><div class="rating-stars" role="group" aria-label="Optional personal rating">${[1,2,3,4,5].map(value=>`<button type="button" class="rating-star" data-completion-stars="${value}" aria-label="Rate ${value} ${value===1 ? "star" : "stars"}" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/></svg></button>`).join("")}</div><button id="skip-rating" type="button" class="link-button" hidden>Skip rating</button><p class="muted" id="completion-rating-hint">${current ? `Your ${current}/5 rating stays unless you choose a new one.` : "Leave unrated if you prefer."}</p></section><button id="confirm-completion" class="button full">${label}</button>`);
 modal.querySelectorAll("[data-completion-stars]").forEach(button=>button.onclick=()=>{
  stars=Number(button.dataset.completionStars);
  modal.querySelectorAll("[data-completion-stars]").forEach(control=>{control.classList.toggle("filled",Number(control.dataset.completionStars)<=stars);control.setAttribute("aria-pressed",String(Number(control.dataset.completionStars)===stars));});
  $("#skip-rating").hidden=false;
 });
 $("#skip-rating").onclick=()=>{stars=null;modal.querySelectorAll("[data-completion-stars]").forEach(control=>{control.classList.remove("filled");control.setAttribute("aria-pressed","false");});$("#skip-rating").hidden=true;};
 $("#confirm-completion").onclick=event=>run(event.currentTarget,async()=>{
  const selectedStars=stars;
  const controls=[...modal.querySelectorAll("[data-completion-stars],#skip-rating")];
  controls.forEach(control=>control.disabled=true);
  try {
  checked(await db.rpc("mojo_mark_completion",{target_entry:entry.id,completion,stars:selectedStars}));
  state.profileHistory=null;
  await loadMovies();closeModal();render();toast(completion==="dnf" ? "Marked did not finish for this group." : "Marked watched for this group.");
  } finally { controls.forEach(control=>{if(control.isConnected)control.disabled=false;}); }
 });
}
