// Core Setup
const joinGroupCodeInput = document.getElementById('join-group-code');
const joinGroupBtn = document.getElementById('join-group-btn');

const groupDetailSection = document.getElementById('group-detail-section');
const backToGroupsBtn = document.getElementById('back-to-groups');
const groupNameTitle = document.getElementById('group-name-title');
const movieList = document.getElementById('movie-list');
const newMovieTitleInput = document.getElementById('new-movie-title');
const tmdbResultsList = document.getElementById('tmdb-results');
const addMovieManualBtn = document.getElementById('add-movie-manual-btn');

const createGroupBtn = document.getElementById('create-group-btn');
const newGroupNameInput = document.getElementById('new-group-name');
const SUPABASE_URL = 'https://fhynhdekctvstiolykgo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoeW5oZGVrY3R2c3Rpb2x5a2dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4MDQxMjMsImV4cCI6MjA2OTM4MDEyM30.JdV5Qy8135nCp1jnozAaZ5tcEE2CaMlBUZjnNEg0tvM';
const TMDB_API_KEY = '432c97c5d26a7a17fd6f4897a4cf4649'; 

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// Auth Elements
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const signupBtn = document.getElementById('signup-btn');
const logoutBtn = document.getElementById('logout-btn');

const authSection = document.getElementById('auth-section');
const mainSection = document.getElementById('main-section');
const groupList = document.getElementById('group-list');

let currentGroupId = null;
let tmdbTimeout;

backToGroupsBtn.onclick = () => {
  groupDetailSection.classList.add('hidden');
  mainSection.classList.remove('hidden');
  currentGroupId = null;
  localStorage.removeItem('lastGroupId');
};

// Login
loginBtn.onclick = async () => {
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: emailInput.value,
    password: passwordInput.value,
  });
  if (error) {
    alert(error.message);
  } else {
    loadGroups();
  }
};

// Signup
signupBtn.onclick = async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    alert("Email and password are required.");
    return;
  }

  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
  });

  if (error) {
    alert("Signup failed: " + error.message);
  } else {
    alert("Account created! Please wait for approval.");
  }
};



// Logout
logoutBtn.onclick = async () => {
  await supabaseClient.auth.signOut();
  location.reload();
};

// Create Group
createGroupBtn.onclick = async () => {
  const groupName = newGroupNameInput.value.trim();
  if (!groupName) {
    alert("Please enter a group name.");
    return;
  }
  const {
    data: { user }
  } = await supabaseClient.auth.getUser();

  const { data: groupData, error: groupError } = await supabaseClient
    .from('groups')
    .insert({ name: groupName, created_by: user.id })
    .select()
    .single();

  if (groupError) {
    alert("Error creating group.");
    console.error(groupError);
    return;
  }

  const { error: memberError } = await supabaseClient
    .from('group_members')
    .insert({ user_id: user.id, group_id: groupData.id });

  if (memberError) {
    alert("Group created, but failed to add you as a member.");
    console.error(memberError);
    return;
  }

  newGroupNameInput.value = '';
  await loadGroups();
};

  joinGroupBtn.onclick = async () => {
    const code = joinGroupCodeInput.value.trim();
    if (!code) return;

    const {
      data: { user }
    } = await supabaseClient.auth.getUser();

    const { data: group, error } = await supabaseClient
      .from('groups')
      .select('id, name')
      .eq('id', code)
      .single();

    if (error || !group) {
      alert("Group not found.");
      return;
    }

    const { error: memberError } = await supabaseClient
      .from('group_members')
      .insert({ user_id: user.id, group_id: group.id });

    if (memberError) {
      alert("You're already a member of this group or join failed.");
      console.error(memberError);
      return;
    }

    joinGroupCodeInput.value = '';
    alert(`Joined group: ${group.name}`);
    loadGroups();
  };



// Load Watch Groups
async function loadGroups() {
  const {
    data: { user }
  } = await supabaseClient.auth.getUser();
  if (!user) return;

  authSection.classList.add('hidden');
  mainSection.classList.remove('hidden');

  const { data, error } = await supabaseClient
    .rpc('get_user_groups_with_counts', { uid: user.id });

  groupList.innerHTML = '';

  if (error) {
    groupList.innerHTML = '<li>Error loading groups</li>';
    console.error(error);
    return;
  }

  if (data.length === 0) {
    groupList.innerHTML = '<li class="text-sm text-gray-300">No groups yet.</li>';
  } else {
    data.forEach((group) => {
      const li = document.createElement('li');
      li.className = 'bg-slate-700 p-3 rounded shadow text-white flex justify-between items-center';

      const info = document.createElement('div');
      info.className = 'cursor-pointer';
      info.title = group.group_id;
      info.onclick = () => {
        currentGroupId = group.group_id;
        localStorage.setItem('lastGroupId', group.group_id);
        groupNameTitle.textContent = `Group: ${group.group_name}`;
        document.getElementById('group-join-code').textContent = `Join Code: ${group.group_id}`;
        mainSection.classList.add('hidden');
        groupDetailSection.classList.remove('hidden');
        loadMovies();
      };

      info.innerHTML = `
        <div class="font-semibold">${group.group_name}</div>
        <div class="text-xs text-gray-300">${group.member_count} member${group.member_count === 1 ? '' : 's'}</div>
      `;

      const actionBtn = document.createElement('button');
      actionBtn.className = 'text-sm text-red-400 hover:text-red-500';

      if (group.created_by === user.id) {
        actionBtn.textContent = '🗑 Delete';
        actionBtn.title = 'Delete group';
        actionBtn.onclick = async (e) => {
          e.stopPropagation();
          if (confirm(`Delete "${group.group_name}" and all its data?`)) {
            await deleteGroup(group.group_id);
            loadGroups();
          }
        };
      } else {
        actionBtn.textContent = '🚪 Leave';
        actionBtn.title = 'Leave group';
        actionBtn.onclick = async (e) => {
          e.stopPropagation();
          if (confirm(`Leave group "${group.group_name}"?`)) {
            await supabaseClient
              .from('group_members')
              .delete()
              .eq('user_id', user.id)
              .eq('group_id', group.group_id);
            loadGroups();
          }
        };
      }

      li.appendChild(info);
      li.appendChild(actionBtn);
      groupList.appendChild(li);
    });
  }
}




// Delete Watch Groups
async function deleteGroup(groupId) {
  try {
    // Delete related data first
    await supabaseClient.from('group_movies').delete().eq('group_id', groupId);
    await supabaseClient.from('group_members').delete().eq('group_id', groupId);

    // Attempt to delete the group
    const { error } = await supabaseClient.from('groups').delete().eq('id', groupId);
    if (error) throw error;
  } catch (err) {
    alert("You must be the group creator to delete this group.");
    console.error(err.message);
  }
}

// Load Movies
async function loadMovies() {
  const { data, error } = await supabaseClient
    .from('group_movies')
    .select('id, watched, movie_id, movies(title, poster_url, release_year, tmdb_id)')
    .eq('group_id', currentGroupId)

  movieList.innerHTML = '';

  if (error) {
    movieList.innerHTML = '<li>Error loading movies.</li>';
    return;
  }

  if (data.length === 0) {
    movieList.innerHTML = '<li class="text-sm text-gray-300">No movies yet.</li>';
  } else {
    data.sort((a, b) => a.watched - b.watched); 
    data.forEach((entry) => {
      const li = document.createElement('li');
      li.className = `bg-slate-700 p-3 rounded shadow text-white flex justify-between items-center`;

const content = document.createElement('div');
content.className = 'flex items-center gap-3';

if (entry.movies.poster_url) {
  const poster = document.createElement('img');
  poster.src = entry.movies.poster_url;
  poster.className = 'w-12 rounded shadow';
  content.appendChild(poster);
}

const textBlock = document.createElement('div');
const titleEl = document.createElement('div');
titleEl.className = "font-semibold text-cyan-300 hover:underline cursor-pointer";
titleEl.textContent = entry.movies.title;

if (entry.movies.tmdb_id) {
  fetch(`https://api.themoviedb.org/3/movie/${entry.movies.tmdb_id}/external_ids?api_key=${TMDB_API_KEY}`)
    .then(res => res.json())
    .then(json => {
      if (json.imdb_id) {
        titleEl.onclick = () => {
          window.open(`https://www.imdb.com/title/${json.imdb_id}`, '_blank');
        };
        titleEl.title = "Open in IMDb";
      }
    })
    .catch(err => console.error(`IMDb ID fetch failed for ${entry.movies.title}`, err));
}

textBlock.appendChild(titleEl);

const yearEl = document.createElement('div');
yearEl.className = 'text-xs text-gray-300';
yearEl.textContent = entry.movies.release_year || '';
textBlock.appendChild(yearEl);


// Add streaming providers
if (entry.movies.tmdb_id) {
  fetch(`https://api.themoviedb.org/3/movie/${entry.movies.tmdb_id}/watch/providers?api_key=${TMDB_API_KEY}`)
    .then(res => res.json())
    .then(json => {
      const providers = json.results?.US?.flatrate || [];
      if (providers.length > 0) {
        const providerContainer = document.createElement('div');
        providerContainer.className = 'flex gap-2 mt-1';

        providers.forEach(provider => {
          const logo = document.createElement('img');
          logo.src = `https://image.tmdb.org/t/p/w45${provider.logo_path}`;
          logo.alt = provider.provider_name;
          logo.title = provider.provider_name;
          logo.className = 'w-6 h-6 rounded';
          providerContainer.appendChild(logo);
        });

        textBlock.appendChild(providerContainer);
      }
    })
    .catch(err => {
      console.error(`Failed to load watch providers for ${entry.movies.title}`, err);
    });
}
      
content.appendChild(textBlock);


      const toggle = document.createElement('button');
      toggle.textContent = entry.watched ? '✅ Watched' : '👀 To Watch';
      toggle.className = entry.watched
        ? 'text-green-400 hover:underline'
        : 'text-yellow-400 hover:underline';

      toggle.onclick = async () => {
        await supabaseClient
          .from('group_movies')
          .update({ watched: !entry.watched })
          .eq('id', entry.id);
        loadMovies();
      };

      const controls = document.createElement('div');
controls.className = 'flex items-center gap-3';

controls.appendChild(toggle);

// 🗑 Delete button
const delBtn = document.createElement('button');
delBtn.innerHTML = '🗑';
delBtn.title = 'Delete movie';
delBtn.className = 'text-red-400 hover:text-red-500 text-lg';
delBtn.onclick = async () => {
  if (confirm(`Delete "${entry.movies.title}" from group?`)) {
    await supabaseClient.from('group_movies').delete().eq('id', entry.id);
    loadMovies();
  }
};

controls.appendChild(delBtn);

li.appendChild(content);
li.appendChild(controls);

      movieList.appendChild(li);
    });
  }
}

//Load Group Details - Helps with persistence across refreshes
async function loadGroupDetails(groupId) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: group, error } = await supabaseClient
    .from('groups')
    .select('id, name')
    .eq('id', groupId)
    .single();

  if (error || !group) {
    console.warn('Group not found or no longer accessible.');
    localStorage.removeItem('lastGroupId');
    loadGroups();
    return;
  }

  groupNameTitle.textContent = `Group: ${group.name}`;
  document.getElementById('group-join-code').textContent = `Join Code: ${group.id}`;
  loadMovies();
}


newMovieTitleInput.addEventListener('input', () => {
  clearTimeout(tmdbTimeout);
  const query = newMovieTitleInput.value.trim();
  if (!query) {
    tmdbResultsList.classList.add('hidden');
    tmdbResultsList.innerHTML = '';
    return;
  }
  tmdbTimeout = setTimeout(() => searchTMDB(query), 400);
});

// Search TMDB
async function searchTMDB(query) {
  tmdbResultsList.innerHTML = '<li class="text-sm text-gray-300">Searching...</li>';
  tmdbResultsList.classList.remove('hidden');

  const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
  const json = await res.json();

  if (!json.results || json.results.length === 0) {
    tmdbResultsList.innerHTML = '<li class="text-sm text-red-400">No matches found</li>';
    return;
  }

  tmdbResultsList.innerHTML = '';
  json.results.slice(0, 5).forEach(movie => {
    const li = document.createElement('li');
    li.className = 'cursor-pointer hover:bg-slate-600 p-2 rounded flex items-center gap-3';
    li.innerHTML = `
      ${movie.poster_path ? `<img src="https://image.tmdb.org/t/p/w92${movie.poster_path}" class="w-10 rounded" />` : ''}
      <div>
        <div class="font-semibold">${movie.title}</div>
        <div class="text-xs text-gray-300">${movie.release_date?.split('-')[0] || 'N/A'}</div>
      </div>
    `;
    li.onclick = () => addMovieFromTMDB(movie);
    tmdbResultsList.appendChild(li);
  });
}

// Add From TMDB
async function addMovieFromTMDB(movie) {
  const {
    data: { user }
  } = await supabaseClient.auth.getUser();

  const { data: insertedMovie, error } = await supabaseClient
    .from('movies')
    .insert({
      title: movie.title,
      tmdb_id: movie.id.toString(),
      release_year: parseInt(movie.release_date?.split('-')[0]) || null,
      poster_url: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null
    })
    .select()
    .single();

  if (error) {
    alert("Failed to add movie.");
    console.error(error);
    return;
  }

  await supabaseClient.from('group_movies').insert({
    group_id: currentGroupId,
    movie_id: insertedMovie.id,
    added_by: user.id
  });

  newMovieTitleInput.value = '';
  tmdbResultsList.innerHTML = '';
  tmdbResultsList.classList.add('hidden');
  loadMovies();
}

addMovieManualBtn.onclick = async () => {
  const title = newMovieTitleInput.value.trim();
  if (!title || !currentGroupId) return;

  const {
    data: { user }
  } = await supabaseClient.auth.getUser();

  const { data: movie, error: movieError } = await supabaseClient
    .from('movies')
    .insert({ title })
    .select()
    .single();

  if (movieError) {
    alert("Failed to add movie manually.");
    console.error(movieError);
    return;
  }

  await supabaseClient.from('group_movies').insert({
    group_id: currentGroupId,
    movie_id: movie.id,
    added_by: user.id
  });

  newMovieTitleInput.value = '';
  tmdbResultsList.innerHTML = '';
  tmdbResultsList.classList.add('hidden');
  loadMovies();
};

supabaseClient.auth.onAuthStateChange((event, session) => {
  // Always show the app wrapper after Supabase has responded
  document.getElementById('app').classList.remove('hidden');

  // Always hide all sections first
  authSection.classList.add('hidden');
  mainSection.classList.add('hidden');
  groupDetailSection.classList.add('hidden');

  if (session) {
    const savedGroupId = localStorage.getItem('lastGroupId');
    if (savedGroupId) {
      currentGroupId = savedGroupId;
      groupDetailSection.classList.remove('hidden');
      loadGroupDetails(savedGroupId);
    } else {
      mainSection.classList.remove('hidden');
      loadGroups();
    }
  } else {
    authSection.classList.remove('hidden');
  }
});



// ✅ Register Service Worker (PWA support)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered:', reg.scope))
      .catch(err => console.error('Service Worker registration failed:', err));
  });
}

// ✅ Show iOS Install Banner
function isiOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) &&
         !window.matchMedia('(display-mode: standalone)').matches;
}

if (isiOS() && !localStorage.getItem('dismissedIosBanner')) {
  const iosBanner = document.getElementById('ios-banner');
  const dismissBtn = document.getElementById('dismiss-ios-banner');

  iosBanner.classList.remove('hidden');

  dismissBtn.onclick = () => {
    iosBanner.classList.add('hidden');
    localStorage.setItem('dismissedIosBanner', 'true');
  };
}

PullToRefresh.init({
  mainElement: currentGroupId ? '#group-detail-section' : '#main-section',
  onRefresh() {
    if (currentGroupId) {
      return loadMovies();
    } else {
      return loadGroups();
    }
  },
  instructionsPullToRefresh: '↓ Pull down to refresh',
  instructionsReleaseToRefresh: '↻ Release to refresh',
  instructionsRefreshing: 'Refreshing…',
});

