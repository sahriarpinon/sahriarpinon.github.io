import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    reauthenticateWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfigs = {
  test: {
  apiKey: "AIzaSyBEqh97QOrdATX3AjKdhh9zQwxE756J8I8",
  authDomain: "gitabitanv2test.firebaseapp.com",
  databaseURL: "https://gitabitanv2test-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gitabitanv2test",
  storageBucket: "gitabitanv2test.appspot.com",
  messagingSenderId: "1047015369768",
  appId: "1:1047015369768:web:0056c5fc63d0868641991d",
  measurementId: "G-DB27BZNTYF"
  },
  live: {
    apiKey: "AIzaSyBrmDTkKtHmDZyUCmR6FPFfNAsBZQWGvNs",
    authDomain: "gitabitanv2.firebaseapp.com",
    databaseURL: "https://gitabitanv2-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "gitabitanv2",
    storageBucket: "gitabitanv2.appspot.com",
    messagingSenderId: "409688549804",
    appId: "1:409688549804:web:5a9076950f22b1eed3f209",
    measurementId: "G-FH41FDGBKB"
  }
};

const SONGS_COLLECTION = "songs";
const firebaseServices = {};
let activeProjectKey = "";
let db = null;
let auth = null;
let unsubscribeAuthState = null;

function clearRemoteConfigToken(projectKey) {
    if (!projectKey) return;
    try {
        sessionStorage.removeItem(`gitabitan-remote-config-token-${projectKey}`);
    } catch (error) {
        console.warn("Could not clear the Remote Config token:", error);
    }
}

function selectFirebaseProject(projectKey) {
    if (!firebaseConfigs[projectKey]) throw new Error("Choose a Firebase project first.");
    if (activeProjectKey && activeProjectKey !== projectKey) clearRemoteConfigToken(activeProjectKey);
    activeProjectKey = projectKey;
    if (!firebaseServices[projectKey]) {
        const projectApp = initializeApp(firebaseConfigs[projectKey], `gitabitan-${projectKey}`);
        firebaseServices[projectKey] = {
            auth: getAuth(projectApp),
            db: getFirestore(projectApp)
        };
    }
    auth = firebaseServices[projectKey].auth;
    db = firebaseServices[projectKey].db;
    try {
        sessionStorage.setItem("gitabitan-active-project", projectKey);
        sessionStorage.setItem("gitabitan-active-project-id", firebaseConfigs[projectKey].projectId);
    } catch (error) {
        console.warn("Could not save the selected Firebase project for this tab:", error);
    }
}

async function loadRemoteConfigVersion() {
    const label = $("projectVersionLabel");
    const projectLabel = activeProjectKey === "live" ? "Live Project" : "Test Project";
    label.textContent = `${projectLabel} | db_version = loading…`;
    const accessToken = sessionStorage.getItem(`gitabitan-remote-config-token-${activeProjectKey}`);
    if (!accessToken) {
        label.textContent = `${projectLabel} | db_version = unavailable`;
        return;
    }

    try {
        const projectId = firebaseConfigs[activeProjectKey].projectId;
        const response = await fetch(`https://firebaseremoteconfig.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/remoteConfig`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!response.ok) throw new Error(`Remote Config request failed (HTTP ${response.status}).`);
        const template = await response.json();
        const version = template.parameters?.db_version?.defaultValue?.value
            ?? Object.values(template.parameterGroups || {}).map(group => group.parameters?.db_version?.defaultValue?.value).find(value => value !== undefined);
        label.textContent = `${projectLabel} | db_version = ${version ?? "not set"}`;
    } catch (error) {
        console.warn("Could not load Remote Config db_version:", error);
        label.textContent = `${projectLabel} | db_version = unavailable`;
    }
}

const editableFields = {
    song_no: "editSongNo",
    song_version: "editSongVersion",
    title: "editTitle",
    letter: "editLetter",
    age: "editAge",
    year: "editYear",
    write_en: "editWriteEn",
    write_bn: "editWriteBn",
    write_place: "editWritePlace",
    notation_writer: "editNotationWriter",
    notation_info: "editNotationInfo",
    notation_file: "editNotationFile",
    porjay: "editPorjay",
    upo_porjay: "editUpoPorjay",
    raag: "editRaag",
    taal: "editTaal",
    publish: "editPublish",
    urlNotation: "editUrlNotation",
    urlNotationPdf: "editUrlNotationPdf",
    lyric: "editLyric",
    lyric_change: "editLyricChange",
    footnote: "editFootnote"
};

let songs = [];
let filteredSongs = [];
let currentDocument = null;
let editing = false;
let jsonFileHandle = null;

const $ = id => document.getElementById(id);

function parseSongJson(text) {
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed.songs;
    if (!Array.isArray(items) || items.some(song => !song || typeof song !== "object" || !song.id)) {
        throw new Error("Expected a songs array with each Firestore document id stored in an id field.");
    }
    return items;
}

async function saveSongFile(items) {
    const contents = `${JSON.stringify(items, null, 2)}\n`;
    if (jsonFileHandle) {
        let permission = await jsonFileHandle.queryPermission({ mode: "readwrite" });
        if (permission !== "granted") permission = await jsonFileHandle.requestPermission({ mode: "readwrite" });
        if (permission !== "granted") throw new Error("Write access to songs.json was not granted.");
        const writable = await jsonFileHandle.createWritable();
        await writable.write(contents);
        await writable.close();
        return "file";
    }

    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "songs.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "download";
}

async function openJsonFile() {
    if (!window.showOpenFilePicker) {
        $("jsonFileInput").click();
        return;
    }
    try {
        const [handle] = await window.showOpenFilePicker({
            multiple: false,
            types: [{ description: "JSON data", accept: { "application/json": [".json"] } }]
        });
        jsonFileHandle = handle;
        const file = await handle.getFile();
        showSongs(parseSongJson(await file.text()), `Loaded ${file.name}`);
    } catch (error) {
        if (error.name !== "AbortError") setStatus(`Could not open songs.json: ${error.message}`, true);
    }
}

async function createJsonFile() {
    try {
        if (window.showSaveFilePicker) {
            jsonFileHandle = await window.showSaveFilePicker({
                suggestedName: "songs.json",
                types: [{ description: "JSON data", accept: { "application/json": [".json"] } }]
            });
        }

        setStatus("Downloading the latest songs from Firestore...");
        const snapshot = await getDocs(collection(db, SONGS_COLLECTION));
        const latestSongs = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
        const savedAs = await saveSongFile(latestSongs);
        showSongs(latestSongs, savedAs === "file"
            ? `Created songs.json with the latest ${latestSongs.length} songs`
            : `Downloaded songs.json with the latest ${latestSongs.length} songs`);
    } catch (error) {
        if (error.name !== "AbortError") {
            console.error(error);
            setStatus(`Could not create songs.json: ${error.message}`, true);
            alert(`Could not create songs.json with the latest Firestore data.\n\n${error.message}`);
        }
    }
}

function setAuthMessage(message, error = false) {
    const element = $("authMessage");
    element.textContent = message;
    element.classList.toggle("error", error);
}

$("googleSignInBtn").addEventListener("click", async () => {
    const button = $("googleSignInBtn");
    const projectKey = $("firebaseProjectSelect").value;
    if (!projectKey) {
        setAuthMessage("Choose Test project or Live project first.", true);
        return;
    }
    button.disabled = true;
    setAuthMessage("Opening Google sign-in…");
    try {
        if (unsubscribeAuthState) unsubscribeAuthState();
        selectFirebaseProject(projectKey);
        unsubscribeAuthState = onAuthStateChanged(auth, handleAuthState);
        const provider = new GoogleAuthProvider();
        // The Remote Config REST API accepts cloud-platform as an alternative scope.
        provider.addScope("https://www.googleapis.com/auth/cloud-platform");
        let result;
        if (auth.currentUser) {
            result = await reauthenticateWithPopup(auth.currentUser, provider);
        } else {
            provider.setCustomParameters({ prompt: "select_account" });
            result = await signInWithPopup(auth, provider);
        }
        const googleCredential = GoogleAuthProvider.credentialFromResult(result);
        if (googleCredential?.accessToken) {
            try {
                sessionStorage.setItem(`gitabitan-remote-config-token-${projectKey}`, googleCredential.accessToken);
                void loadRemoteConfigVersion();
            } catch (error) {
                console.warn("Could not keep the Remote Config token in this tab:", error);
            }
        }
    } catch (error) {
        console.error(error);
        if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") {
            setAuthMessage("Google sign-in was cancelled.");
        } else if (error.code === "auth/unauthorized-domain") {
            setAuthMessage("Add this site’s domain to Firebase Authentication → Settings → Authorized domains.", true);
        } else {
            setAuthMessage(error.message || "Google sign-in failed. Please try again.", true);
        }
    } finally {
        button.disabled = false;
    }
});

$("signOutBtn").addEventListener("click", () => signOut(auth));

const settingsMenuButton = $("settingsMenuBtn");
const settingsDropdown = $("settingsDropdown");
const themeToggleButton = $("themeToggleBtn");
const authThemeToggleButton = $("authThemeToggleBtn");
const appShell = $("appShell");
const songNavToggleButton = $("openSongNavBtn");
const songNavCloseButton = $("closeSongNavBtn");
const sidebarBackdrop = $("sidebarBackdrop");

function setSongNavigationOpen(open) {
    appShell.classList.toggle("nav-open", open);
    document.body.classList.toggle("nav-open", open);
    songNavToggleButton.setAttribute("aria-expanded", String(open));
    if (open) closeSettingsMenu();
}

songNavToggleButton.addEventListener("click", () => setSongNavigationOpen(true));
songNavCloseButton.addEventListener("click", () => setSongNavigationOpen(false));
sidebarBackdrop.addEventListener("click", () => setSongNavigationOpen(false));

function setNightMode(enabled, savePreference = true) {
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
    themeToggleButton.setAttribute("aria-checked", String(enabled));
    authThemeToggleButton.setAttribute("aria-pressed", String(enabled));
    if (savePreference) {
        try {
            localStorage.setItem("gitabitan-editor-theme", enabled ? "dark" : "light");
        } catch (error) {
            console.warn("Could not save the theme preference:", error);
        }
    }
}

let savedNightMode = false;
try {
    savedNightMode = localStorage.getItem("gitabitan-editor-theme") === "dark";
} catch (error) {
    console.warn("Could not read the saved theme preference:", error);
}
setNightMode(savedNightMode, false);

themeToggleButton.addEventListener("click", () => {
    setNightMode(themeToggleButton.getAttribute("aria-checked") !== "true");
});

authThemeToggleButton.addEventListener("click", () => {
    setNightMode(authThemeToggleButton.getAttribute("aria-pressed") !== "true");
});

function closeSettingsMenu(returnFocus = false) {
    settingsDropdown.hidden = true;
    settingsMenuButton.setAttribute("aria-expanded", "false");
    if (returnFocus) settingsMenuButton.focus();
}

settingsMenuButton.addEventListener("click", () => {
    const isOpening = settingsDropdown.hidden;
    settingsDropdown.hidden = !isOpening;
    settingsMenuButton.setAttribute("aria-expanded", String(isOpening));
});

settingsDropdown.addEventListener("click", event => {
    if (event.target.closest('[role="menuitem"]')) closeSettingsMenu(true);
});

document.addEventListener("click", event => {
    if (!event.target.closest(".settings-menu")) closeSettingsMenu();
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !settingsDropdown.hidden) closeSettingsMenu(true);
    if (event.key === "Escape" && appShell.classList.contains("nav-open")) {
        setSongNavigationOpen(false);
        songNavToggleButton.focus();
    }
});

async function handleAuthState(user) {
    if (user && user.emailVerified) {
        $("authScreen").classList.add("hidden");
        $("appShell").classList.remove("hidden");
        $("signedInEmail").textContent = user.email || "Signed in";
        void loadRemoteConfigVersion();
        let isAdmin = false;

        try {
            const token = await user.getIdTokenResult(true);
            isAdmin = token.claims.admin === true;
            $("editBtn").disabled = !isAdmin;
            $("editBtn").title = isAdmin ? "" : "This account does not have the admin claim.";
        } catch (error) {
            console.error("Could not check admin claim:", error);
            $("editBtn").disabled = true;
            setStatus("Could not verify admin access. Sign in again and retry.", true);
        }

        await loadSongs();
        if (!isAdmin) {
            setStatus("Songs loaded. This account has no admin claim, so saving is disabled.", true);
        }
    } else {
        clearRemoteConfigToken(activeProjectKey);
        $("editBtn").disabled = false;
        $("appShell").classList.add("hidden");
        $("authScreen").classList.remove("hidden");
        $("signedInEmail").textContent = "";
    }
}

function displayId(field) {
    const ids = {
        song_no: "songNoDisplay",
        song_version: "songVersionDisplay",
        lyric: "lyricDisplay",
        lyric_change: "lyricChangeDisplay",
        footnote: "footnoteDisplay"
    };
    return ids[field] || `${field}Display`;
}

function value(value) {
    return value === null || value === undefined ? "" : String(value);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;")
        .replaceAll('"',"&quot;")
        .replaceAll("'","&#039;");
}

function setStatus(message,error=false) {
    $("saveStatus").textContent = message;
    $("saveStatus").style.color = error ? "#dc2626" : "#6b7280";
}

function renderSongList() {
    $("songList").innerHTML = "";
    $("songCount").textContent = `${filteredSongs.length} song${filteredSongs.length === 1 ? "" : "s"}`;

    filteredSongs.forEach(song => {
        const item = document.createElement("div");
        item.className = "song-item" + (currentDocument?.id === song.id ? " active" : "");
        item.innerHTML = `<strong>${escapeHtml(song.title || "(No title)")}</strong><span>${escapeHtml(song.song_no || "")} · ${escapeHtml(song.porjay || "")}</span>`;
        item.addEventListener("click", () => selectSong(song.id));
        $("songList").appendChild(item);
    });
}

function populateFilters() {
    const porjays = [...new Set(songs.map(s => s.porjay).filter(Boolean))].sort();
    const letters = [...new Set(songs.map(s => s.letter).filter(Boolean))].sort();

    $("porjayFilter").innerHTML = `<option value="">All Porjay</option>${porjays.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}`;
    $("letterFilter").innerHTML = `<option value="">All Letters</option>${letters.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}`;
}

function applyFilters() {
    const search = $("searchInput").value.trim().toLowerCase();
    const porjay = $("porjayFilter").value;
    const letter = $("letterFilter").value;

    filteredSongs = songs.filter(song => {
        const searchable = [
            song.title,song.song_no,song.song_id,song.song_index,
            song.lyric,song.write_en,song.write_bn,song.raag,song.taal
        ].map(value).join(" ").toLowerCase();

        return (!search || searchable.includes(search)) &&
            (!porjay || song.porjay === porjay) &&
            (!letter || song.letter === letter);
    });

    renderSongList();
}

function setEditMode(enabled) {
    editing = enabled;
    $("songView").classList.toggle("editing", enabled);
    $("editBtn").classList.toggle("hidden", enabled);
    $("cancelBtn").classList.toggle("hidden", !enabled);
    $("saveBtn").classList.toggle("hidden", !enabled);

    Object.values(editableFields).forEach(id => {
        $(id).disabled = !enabled;
    });

    setStatus(enabled ? "Editing..." : "Ready");
}

function renderSong(song) {
    currentDocument = song;
    $("emptyState").classList.add("hidden");
    $("songView").classList.remove("hidden");
    $("pageTitle").textContent = value(song.title) || "Untitled";
    $("songTitleHeading").textContent = value(song.title) || "Untitled";
    $("songNumberHeading").textContent = `Song No: ${value(song.song_no)}`;

    $("documentId").value = song.id;
    $("songId").value = value(song.song_id);
    $("songIndex").value = value(song.song_index);

    Object.entries(editableFields).forEach(([field,inputId]) => {
        const v = value(song[field]);
        $(inputId).value = v;
        $(displayId(field)).textContent = v;
    });

    $("rawJson").textContent = JSON.stringify(song,null,2);

    const index = filteredSongs.findIndex(s => s.id === song.id);
    $("prevBtn").disabled = index <= 0;
    $("nextBtn").disabled = index < 0 || index >= filteredSongs.length - 1;

    setEditMode(false);
    renderSongList();
}

function showSongs(items, statusMessage) {
    songs = [...items].sort((a,b) => Number(a.song_index ?? a.song_id ?? 0) - Number(b.song_index ?? b.song_id ?? 0));
    populateFilters();
    applyFilters();

    if (currentDocument) {
        const updated = songs.find(song => song.id === currentDocument.id);
        if (updated) renderSong(updated);
    }
    setStatus(statusMessage || `Loaded ${songs.length} songs`);
}

async function loadSongs() {
    songs = [];
    filteredSongs = [];
    currentDocument = null;
    $("songView").classList.add("hidden");
    $("emptyState").classList.remove("hidden");
    applyFilters();
    setStatus("Choose Open songs.json to load your local data.");
}

async function updateAllSongs() {
    setStatus("Downloading all songs from Firestore...");

    try {
        const snapshot = await getDocs(collection(db, SONGS_COLLECTION));
        const downloaded = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
        const savedAs = await saveSongFile(downloaded);
        showSongs(downloaded, savedAs === "file"
            ? `Rewrote songs.json with all ${downloaded.length} songs`
            : `Downloaded songs.json with all ${downloaded.length} songs; replace the old file`);
    } catch(error) {
        console.error(error);
        setStatus(`Full update failed: ${error.message}`, true);
        alert(`Could not update all songs from Firestore.\n\n${error.message}`);
    }
}

async function updateCurrentSong() {
    if (!currentDocument) return;
    if (editing && !confirm("Discard your unsaved changes and refresh this song from Firestore?")) return;

    setStatus("Updating this song from Firestore...");
    try {
        const snapshot = await getDoc(doc(db, SONGS_COLLECTION, currentDocument.id));
        if (!snapshot.exists()) throw new Error("This song no longer exists in Firestore.");

        const refreshedSong = { id: snapshot.id, ...snapshot.data() };
        const index = songs.findIndex(song => song.id === refreshedSong.id);
        if (index >= 0) songs[index] = refreshedSong;
        else songs.push(refreshedSong);
        const savedAs = await saveSongFile(songs);
        populateFilters();
        applyFilters();
        renderSong(refreshedSong);
        setStatus(savedAs === "file"
            ? `Updated “${refreshedSong.title || refreshedSong.id}” in songs.json`
            : "Downloaded songs.json with the updated song; replace the old file");
    } catch(error) {
        console.error(error);
        setStatus(`Song update failed: ${error.message}`, true);
        alert(`Could not update this song from Firestore.\n\n${error.message}`);
    }
}

async function saveChanges() {
    if (!currentDocument) return;

    const updates = {};

    try {
        for (const [field,inputId] of Object.entries(editableFields)) {
            const input = $(inputId);

            if (field === "song_version") {
                if (input.value.trim() === "") throw new Error("Song Version cannot be empty.");
                const numberValue = Number(input.value);
                if (!Number.isFinite(numberValue)) throw new Error("Song Version must be a valid number.");
                updates[field] = numberValue;
            } else {
                updates[field] = input.value;
            }
        }

        setStatus("Saving...");
        await updateDoc(doc(db,SONGS_COLLECTION,currentDocument.id),updates);

        currentDocument = {...currentDocument,...updates};

        const index = songs.findIndex(s => s.id === currentDocument.id);
        if (index >= 0) songs[index] = currentDocument;

        applyFilters();
        renderSong(currentDocument);
        try {
            const savedAs = await saveSongFile(songs);
            setStatus(savedAs === "file"
                ? "✓ Saved to Firestore and songs.json"
                : "Saved to Firestore and downloaded songs.json; replace the old file");
        } catch (fileError) {
            console.error("Firestore save succeeded, but JSON file update failed:", fileError);
            setStatus(`Saved to Firestore, but songs.json update failed: ${fileError.message}`, true);
        }
    } catch(error) {
        console.error(error);
        setStatus(`Save failed: ${error.message}`,true);
        alert(`Save failed:

${error.message}`);
    }
}

function selectSong(id) {
    if (editing && !confirm("You have unsaved changes. Discard them?")) return;
    const song = songs.find(s => s.id === id);
    if (song) {
        renderSong(song);
        setSongNavigationOpen(false);
    }
}

function moveSong(direction) {
    if (!currentDocument) return;
    if (editing && !confirm("You have unsaved changes. Discard them?")) return;

    const index = filteredSongs.findIndex(s => s.id === currentDocument.id);
    const nextIndex = index + direction;

    if (nextIndex >= 0 && nextIndex < filteredSongs.length) {
        renderSong(filteredSongs[nextIndex]);
    }
}

$("searchInput").addEventListener("input",applyFilters);
$("porjayFilter").addEventListener("change",applyFilters);
$("letterFilter").addEventListener("change",applyFilters);
$("openJsonBtn").addEventListener("click", openJsonFile);
$("createJsonBtn").addEventListener("click", createJsonFile);
$("jsonFileInput").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    jsonFileHandle = null;
    try {
        showSongs(parseSongJson(await file.text()), `Loaded ${file.name}. Updates download a replacement file.`);
    } catch (error) {
        setStatus(`Could not read songs.json: ${error.message}`, true);
    } finally {
        event.target.value = "";
    }
});

$("refreshBtn").addEventListener("click",() => {
    if (editing && !confirm("Discard your unsaved changes and update all songs?")) return;
    updateAllSongs();
});

$("refreshSongBtn").addEventListener("click", updateCurrentSong);

$("editBtn").addEventListener("click",() => setEditMode(true));
$("cancelBtn").addEventListener("click",() => {
    if (currentDocument) renderSong(currentDocument);
});
$("saveBtn").addEventListener("click",saveChanges);
$("prevBtn").addEventListener("click",() => moveSong(-1));
$("nextBtn").addEventListener("click",() => moveSong(1));
