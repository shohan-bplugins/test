// import { toHHMMSS } from "../js/utils";
function formatTimeFull(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return [
    hrs > 0 ? String(hrs).padStart(2, "0") : null,
    String(mins).padStart(2, "0"),
    String(secs).padStart(2, "0"),
  ]
    .filter(Boolean)
    .join(":");
}
class PlyrPlaylist {
  constructor(player, audios) {
    this.player = player;
    this.audios = audios;
    if (!player.elements.container) return;

    this.shuffle = false;
    this.repeat = false;

    // elements
    this.playlistItems =
      player.elements.container?.querySelectorAll(
        '[data-plyr="playlist-item"]',
      ) || [];
    this.playlistTitle = player.elements.container.querySelector(
      '[data-plyr="playlist-title"]',
    );
    this.playlistToolTipTitle = player.elements.container.querySelector(
      '[data-plyr="playlist-tooltip-title"]',
    );
    this.playlistArtist = player.elements.container.querySelector(
      '[data-plyr="playlist-artist"]',
    );
    this.playlistCover = player.elements.container.querySelector(
      '[data-plyr="playlist-cover"]',
    );
    this.playlistSeeMoreItems = player.elements.container.querySelector(
      '[data-plyr="playlist-see-more-items"]',
    );
    this.nextButton =
      player.elements.container.querySelector('[data-plyr="next"]');
    this.prevButton =
      player.elements.container.querySelector('[data-plyr="prev"]');
    this.seeMoreButton = player.elements.container.querySelector(
      '[data-plyr="see-more"]',
    );
    this.shuffleButton = player.elements.container.querySelector(
      '[data-plyr="shuffle"]',
    );
    this.repeatButton = player.elements.container.querySelector(
      '[data-plyr="repeat"]',
    );
    this.currentIndex = 0;

    this.setupEventListeners();
    this.setItemsDuration();
  }
  setupEventListeners() {
    this.playlistItems.forEach((item, index) => {
      item.addEventListener("click", () => {
        this.switchToAudio(index);
      });
    });

    this.player.on("ended", () => {
      this.next();
    });

    this.nextButton?.addEventListener("click", () => {
      this.next();
    });

    this.prevButton?.addEventListener("click", () => {
      this.prev();
    });

    this.player.on("play", () => {
      this.playlistItems.forEach((item, index) => {
        if (index === this.currentIndex) {
          item.classList.add("item-playing");
        } else {
          item.classList.remove("item-playing");
        }
      });
    });

    this.player.on("pause", () => {
      this.playlistItems.forEach((item, index) => {
        if (index === this.currentIndex) {
          item.classList.remove("item-playing");
        } else {
          item.classList.remove("item-playing");
        }
      });
    });

    this.seeMoreButton?.addEventListener("click", () => {
      if (this.playlistSeeMoreItems.classList.contains("hidden")) {
        this.playlistSeeMoreItems.classList.remove("hidden");
        this.seeMoreButton.classList.remove("rotate-180");
      } else {
        this.playlistSeeMoreItems.classList.add("hidden");
        this.seeMoreButton.classList.add("rotate-180");
      }
    });

    // switch audio
    this.player.on("ready", () => {
      this.switchToAudio(this.currentIndex, false);
    });

    // handle repeat
    this.handleRepeat();
    // handle shuffle
    this.handleShuffle();
  }

  handleShuffle() {
    this.shuffleButton?.addEventListener("click", () => {
      this.shuffle = !this.shuffle;
      if (this.shuffle) {
        this.shuffleButton.classList.add("active");
      } else {
        this.shuffleButton.classList.remove("active");
      }
    });
  }

  handleRepeat() {
    this.repeatButton?.addEventListener("click", () => {
      this.repeat = !this.repeat;
      if (this.repeat) {
        this.repeatButton.classList.add("active");
      } else {
        this.repeatButton.classList.remove("active");
      }
    });
  }

  switchToAudio(index, play = true) {
    if (index < 0 || index >= this.audios.length) return;

    if (this.currentIndex === index && play) {
      if (this.player.playing) {
        this.player.pause()?.catch((error) => {
          //eslint-disable-next-line no-console
          console.error("Error playing audio:", error);
        });
      } else {
        this.player.play()?.catch((error) => {
          //eslint-disable-next-line no-console
          console.error("Error playing audio:", error);
        });
      }
      return;
    }

    this.currentIndex = this.shuffle
      ? Math.floor(Math.random() * this.audios.length)
      : index;
    const src = this.audios[index].source;

    if (!src) return;

    if (this.player.elements.container.querySelector("audio")) {
      this.player.elements.container.querySelector("audio").src = src;
      if (this.playlistTitle) {
        this.playlistTitle.textContent =
          this.audios[this.currentIndex].title?.length > 20
            ? this.audios[this.currentIndex].title.slice(0, 20) + "..."
            : this.audios[this.currentIndex].title;
      }
      if (this.playlistToolTipTitle) {
        this.playlistToolTipTitle.textContent =
          this.audios[this.currentIndex].title;
      }
      if (this.playlistArtist) {
        this.playlistArtist.textContent = this.audios[this.currentIndex].artist;
      }
      if (this.playlistCover) {
        this.playlistCover.src = this.audios[this.currentIndex].poster;
      }

      this.playlistItems.forEach((item, index) => {
        if (index === this.currentIndex) {
          item.classList.add("item-active");
          item.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
          item.classList.remove("item-active");
        }
      });

      if (play) {
        this.player.play()?.catch((error) => {
          //eslint-disable-next-line no-console
          console.error("Error playing audio:", error);
        });
      }
    }
  }
  next() {
    this.switchToAudio((this.currentIndex + 1) % this.audios.length);
  }
  prev() {
    this.switchToAudio(
      (this.currentIndex - 1 + this.audios.length) % this.audios.length,
    );
  }

  setItemsDuration() {
    this.playlistItems.forEach((item, index) => {
      const audio = document.createElement("audio");
      if (item.querySelector(".duration")) {
        audio.src = this.audios[index]?.source;
        audio.addEventListener("loadedmetadata", () => {
          item.querySelector(".duration").innerText = formatTimeFull(
            audio.duration,
          );
        });
      }
    });
  }

  // toHHMMSS(secs) {
  //     var sec_num = parseInt(secs, 10); // don't forget the second param
  //     var hours = Math.floor(sec_num / 3600);
  //     var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
  //     var seconds = sec_num - (hours * 3600) - (minutes * 60);
  //     if (hours < 10) { hours = "0" + hours; }
  //     if (minutes < 10) { minutes = "0" + minutes; }
  //     if (seconds < 10) { seconds = "0" + seconds; }
  //     return hours + ':' + minutes + ':' + seconds;
  // }
}

window.PlyrPlaylist = PlyrPlaylist;
