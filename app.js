import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js";

import { getFirestore, collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";


const firebaseConfig = {
    apiKey: "AIzaSyBEqh97QOrdATX3AjKdhh9zQwxE756J8I8",
    authDomain: "gitabitanv2test.firebaseapp.com",
    databaseURL: "https://gitabitanv2test-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "gitabitanv2test",
    storageBucket: "gitabitanv2test.appspot.com",
    messagingSenderId: "1047015369768",
    appId: "1:1047015369768:web:0056c5fc63d0868641991d",
    measurementId: "G-DB27BZNTYF"
  };

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const SONGS_COLLECTION = "songs";
let songs = [];
let filteredSongs = [];
let currentIndex = -1;
let currentDocument = null;

const songList = document.getElementById("songList");
const songCount = document.getElementById("songCount");
const searchInput = document.getElementById("searchInput");
const porjayFilter = document.getElementById("porjayFilter");
const letterFilter = document.getElementById("letterFilter");
const refreshBtn = document.getElementById("refreshBtn");
const emptyState = document.getElementById("emptyState");
const songView = document.getElementById("songView");
const errorMessage = document.getElementById("errorMessage");
const pageTitle = document.getElementById("pageTitle");
const previousBtn = document.getElementById("previousBtn");
const nextBtn = document.getElementById("nextBtn");
const copyJsonBtn = document.getElementById("copyJsonBtn");

function safeValue(value) {
    return value === undefined || value === null || value === "" ? "—" : String(value);
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = safeValue(value);
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove("hidden");
}

function hideError() {
    errorMessage.classList.add("hidden");
}

async function loadSongs() {
    hideError();
    songList.innerHTML = '<div class="loading">Loading songs...</div>';
    songCount.textContent = "Loading songs...";
    try {
        const snapshot = await getDocs(collection(db, SONGS_COLLECTION));
        songs = [];
        snapshot.forEach(documentSnapshot => {
            songs.push({ id: documentSnapshot.id, ...documentSnapshot.data() });
        });
        songs.sort((a, b) => {
            const aId = Number(a.song_id);
            const bId = Number(b.song_id);
            if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
            return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
        });
        filteredSongs = [...songs];
        populateFilters();
        renderSongList();
    } catch (error) {
        console.error(error);
        showError("Could not load Firestore data. " + error.message);
        songList.innerHTML = '<div class="loading">Failed to load songs.</div>';
        songCount.textContent = "Error";
    }
}

function populateFilters() {
    const porjays = [...new Set(songs.map(song => song.porjay).filter(Boolean))];
    const letters = [...new Set(songs.map(song => song.letter).filter(Boolean))];
    porjays.sort((a, b) => String(a).localeCompare(String(b), "bn"));
    letters.sort((a, b) => String(a).localeCompare(String(b), "bn"));
    porjayFilter.innerHTML = '<option value="">All Porjay</option>';
    porjays.forEach(porjay => {
        const option = document.createElement("option");
        option.value = porjay;
        option.textContent = porjay;
        porjayFilter.appendChild(option);
    });
    letterFilter.innerHTML = '<option value="">All Letters</option>';
    letters.forEach(letter => {
        const option = document.createElement("option");
        option.value = letter;
        option.textContent = letter;
        letterFilter.appendChild(option);
    });
}

function filterSongs() {
    const search = searchInput.value.trim().toLowerCase();
    const selectedPorjay = porjayFilter.value;
    const selectedLetter = letterFilter.value;
    filteredSongs = songs.filter(song => {
        const searchableText = [
            song.title, song.lyric, song.song_no, song.song_id, song.letter,
            song.porjay, song.upo_porjay, song.raag, song.taal
        ].filter(Boolean).join(" ").toLowerCase();
        return (!search || searchableText.includes(search)) &&
            (!selectedPorjay || song.porjay === selectedPorjay) &&
            (!selectedLetter || song.letter === selectedLetter);
    });
    currentIndex = currentDocument ? filteredSongs.findIndex(song => song.id === currentDocument.id) : -1;
    renderSongList();
    updateNavigation();
}

function renderSongList() {
    songList.innerHTML = "";
    songCount.textContent = `${filteredSongs.length} of ${songs.length} songs`;
    if (filteredSongs.length === 0) {
        songList.innerHTML = '<div class="loading">No songs found.</div>';
        return;
    }
    filteredSongs.forEach((song, index) => {
        const button = document.createElement("button");
        button.className = "song-item";
        if (currentDocument && currentDocument.id === song.id) button.classList.add("active");
        const number = safeValue(song.song_id || song.song_index || song.id);
        const title = safeValue(song.title);
        const meta = [song.song_no, song.porjay, song.raag].filter(Boolean).join(" • ");
        button.innerHTML = `<div class="song-item-number">${escapeHtml(number)}</div><div class="song-item-info"><div class="song-item-title">${escapeHtml(title)}</div><div class="song-item-meta">${escapeHtml(meta)}</div></div>`;
        button.addEventListener("click", () => {
            currentIndex = index;
            loadSong(song);
        });
        songList.appendChild(button);
    });
}

async function loadSong(song) {
    hideError();
    try {
        const documentReference = doc(db, SONGS_COLLECTION, song.id);
        const documentSnapshot = await getDoc(documentReference);
        if (!documentSnapshot.exists()) {
            showError(`Document "${song.id}" does not exist.`);
            return;
        }
        currentDocument = { id: documentSnapshot.id, ...documentSnapshot.data() };
        renderSong(currentDocument);
        renderSongList();
        updateNavigation();
    } catch (error) {
        console.error(error);
        showError("Could not load this song. " + error.message);
    }
}

function renderSong(song) {
    emptyState.classList.add("hidden");
    songView.classList.remove("hidden");
    const displayNumber = song.song_no || song.song_id || song.song_index || song.id;
    pageTitle.textContent = song.title || "Song";
    setText("songNumber", displayNumber);
    setText("songTitle", song.title);
    setText("songSubtitle", [song.letter, song.song_no ? `গীতবিতান নং ${song.song_no}` : null].filter(Boolean).join(" • "));
    setText("porjay", song.porjay);
    setText("upoPorjay", song.upo_porjay);
    setText("raag", song.raag);
    setText("taal", song.taal);
    setText("writeYear", song.write_en || song.year);
    setText("publish", song.publish);
    setText("lyrics", song.lyric);

    const lyricChangeContainer = document.getElementById("lyricChangeContainer");
    if (song.lyric_change) {
        setText("lyricChange", song.lyric_change);
        lyricChangeContainer.classList.remove("hidden");
    } else {
        lyricChangeContainer.classList.add("hidden");
    }

    const footnoteContainer = document.getElementById("footnoteContainer");
    if (song.footnote) {
        setText("footnote", song.footnote);
        footnoteContainer.classList.remove("hidden");
    } else {
        footnoteContainer.classList.add("hidden");
    }

    setText("documentId", song.id);
    setText("songId", song.song_id);
    setText("songIndex", song.song_index);
    setText("songNo", song.song_no);
    setText("letter", song.letter);
    setText("age", song.age);
    setText("year", song.year);
    setText("writeEn", song.write_en);
    setText("writeBn", song.write_bn);
    setText("writePlace", song.write_place);
    setText("notationWriter", song.notation_writer);
    setText("notationInfo", song.notation_info);
    setText("notationFile", song.notation_file);
    setText("songVersion", song.song_version);

    const imageLink = document.getElementById("notationImageLink");
    const pdfLink = document.getElementById("notationPdfLink");
    if (song.urlNotation) {
        imageLink.href = song.urlNotation;
        imageLink.classList.remove("hidden");
    } else {
        imageLink.classList.add("hidden");
    }
    if (song.urlNotationPdf) {
        pdfLink.href = song.urlNotationPdf;
        pdfLink.classList.remove("hidden");
    } else {
        pdfLink.classList.add("hidden");
    }

    document.getElementById("rawJson").textContent = JSON.stringify(song, null, 2);
    document.querySelector(".main").scrollTop = 0;
}

function updateNavigation() {
    previousBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex < 0 || currentIndex >= filteredSongs.length - 1;
}

previousBtn.addEventListener("click", () => {
    if (currentIndex > 0) {
        currentIndex--;
        loadSong(filteredSongs[currentIndex]);
    }
});

nextBtn.addEventListener("click", () => {
    if (currentIndex < filteredSongs.length - 1) {
        currentIndex++;
        loadSong(filteredSongs[currentIndex]);
    }
});

searchInput.addEventListener("input", filterSongs);
porjayFilter.addEventListener("change", filterSongs);
letterFilter.addEventListener("change", filterSongs);

refreshBtn.addEventListener("click", async () => {
    currentDocument = null;
    currentIndex = -1;
    emptyState.classList.remove("hidden");
    songView.classList.add("hidden");
    await loadSongs();
});

copyJsonBtn.addEventListener("click", async () => {
    if (!currentDocument) return;
    try {
        await navigator.clipboard.writeText(JSON.stringify(currentDocument, null, 2));
        const originalText = copyJsonBtn.textContent;
        copyJsonBtn.textContent = "Copied!";
        setTimeout(() => { copyJsonBtn.textContent = originalText; }, 1500);
    } catch (error) {
        console.error(error);
    }
});

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

loadSongs();
