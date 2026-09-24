const year = document.querySelector("[data-year]");
const toggle = document.querySelector("[data-theme-toggle]");
const root = document.documentElement;
const storedTheme = localStorage.getItem("theme");
const pullRefresh = document.querySelector("[data-pull-refresh]");

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

if (year) {
  year.textContent = new Date().getFullYear();
}

if (storedTheme === "dark") {
  root.classList.add("dark");
}

if (toggle) {
  toggle.addEventListener("click", () => {
    root.classList.toggle("dark");
    localStorage.setItem("theme", root.classList.contains("dark") ? "dark" : "light");
  });
}

const modal = document.querySelector("[data-image-modal]");
const modalImage = document.querySelector("[data-modal-target]");
const modalButtons = Array.from(document.querySelectorAll("[data-modal-image]"));
const closeButtons = document.querySelectorAll("[data-modal-close]");
const modalPrev = document.querySelector("[data-modal-prev]");
const modalNext = document.querySelector("[data-modal-next]");
const modalContent = document.querySelector(".modal-content");
const modalCounter = document.querySelector("[data-modal-counter]");
let modalGroup = [];
let modalIndex = 0;
let lastModalTrigger = null;

const addSwipeNavigation = (element, onPrevious, onNext) => {
  if (!element) return;

  let startX = 0;
  let startY = 0;
  let isTracking = false;
  let didSwipe = false;

  element.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      isTracking = true;
      didSwipe = false;
    },
    { passive: true },
  );

  element.addEventListener(
    "pointerup",
    (event) => {
      if (!isTracking) return;
      isTracking = false;

      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      const isHorizontalSwipe = Math.abs(deltaX) > 46 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;

      if (!isHorizontalSwipe) return;
      didSwipe = true;

      if (deltaX < 0) {
        onNext();
      } else {
        onPrevious();
      }
    },
    { passive: true },
  );

  element.addEventListener(
    "pointercancel",
    () => {
      isTracking = false;
    },
    { passive: true },
  );

  element.addEventListener(
    "click",
    (event) => {
      if (!didSwipe) return;
      event.preventDefault();
      event.stopPropagation();
      didSwipe = false;
    },
    true,
  );
};

const setModalImage = (button) => {
  if (!modal || !modalImage || !button) return;
  const src = button.getAttribute("data-modal-image");
  const caption = button.getAttribute("data-modal-caption") || "Project preview";

  if (!src) return;
  modalImage.src = src;
  modalImage.alt = caption;
  modal.hidden = false;
  modal.classList.toggle("has-single-image", modalGroup.length <= 1);
  document.body.classList.add("has-open-modal");
  if (modalCounter) {
    modalCounter.textContent = modalGroup.length > 1 ? `${modalIndex + 1} / ${modalGroup.length}` : "";
  }
};

const closeModal = () => {
  if (!modal || !modalImage) return;
  const wasOpen = !modal.hidden;
  modal.hidden = true;
  modalImage.removeAttribute("src");
  modalImage.alt = "";
  modal.classList.remove("has-single-image");
  document.body.classList.remove("has-open-modal");
  if (wasOpen) lastModalTrigger?.focus({ preventScroll: true });
};

modalButtons.forEach((button) => {
  button.addEventListener("click", () => {
    lastModalTrigger = button;
    const group = button.getAttribute("data-modal-group");
    modalGroup = modalButtons.filter((item) => item.getAttribute("data-modal-group") === group);
    modalIndex = modalGroup.indexOf(button);
    setModalImage(button);
  });
});

closeButtons.forEach((button) => {
  button.addEventListener("click", closeModal);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
  if (event.key === "ArrowLeft") modalPrev?.click();
  if (event.key === "ArrowRight") modalNext?.click();
});

modalPrev?.addEventListener("click", () => {
  if (!modalGroup.length || modal?.hidden) return;
  modalIndex = (modalIndex - 1 + modalGroup.length) % modalGroup.length;
  setModalImage(modalGroup[modalIndex]);
});

modalNext?.addEventListener("click", () => {
  if (!modalGroup.length || modal?.hidden) return;
  modalIndex = (modalIndex + 1) % modalGroup.length;
  setModalImage(modalGroup[modalIndex]);
});

addSwipeNavigation(
  modalContent,
  () => modalPrev?.click(),
  () => modalNext?.click(),
);

document.querySelectorAll("[data-slider]").forEach((slider) => {
  const slides = Array.from(slider.querySelectorAll("[data-slide]"));
  const dots = Array.from(slider.querySelectorAll("[data-slide-dot]"));
  const prev = slider.querySelector("[data-slider-prev]");
  const next = slider.querySelector("[data-slider-next]");
  const track = slider.querySelector(".slider-track");
  let activeIndex = 0;

  const showSlide = (index) => {
    if (!slides.length) return;
    activeIndex = (index + slides.length) % slides.length;

    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle("is-active", slideIndex === activeIndex);
      slide.toggleAttribute("aria-hidden", slideIndex !== activeIndex);

      // Only the visible slide's video keeps playing.
      const video = slide.querySelector("video");
      if (!video) return;
      if (slideIndex === activeIndex) {
        if (video.autoplay) video.play().catch(() => {});
      } else {
        video.pause();
      }
    });

    dots.forEach((dot, dotIndex) => {
      const isActive = dotIndex === activeIndex;
      dot.classList.toggle("is-active", isActive);
      if (isActive) {
        dot.setAttribute("aria-current", "true");
      } else {
        dot.removeAttribute("aria-current");
      }
    });
  };

  prev?.addEventListener("click", () => showSlide(activeIndex - 1));
  next?.addEventListener("click", () => showSlide(activeIndex + 1));

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      showSlide(Number(dot.getAttribute("data-slide-dot")));
    });
  });

  addSwipeNavigation(
    track,
    () => showSlide(activeIndex - 1),
    () => showSlide(activeIndex + 1),
  );

  showSlide(0);
});

const sectionLinks = Array.from(document.querySelectorAll("[data-section-link]"));
const pageTrack = document.querySelector("[data-page-track]");
const pageEdgeButtons = Array.from(document.querySelectorAll("[data-page-edge]"));
const pagedModeQuery = window.matchMedia("(min-width: 0px)");
const phonePageQuery = window.matchMedia("(max-width: 767px)");
const touchPageQuery = window.matchMedia("(max-width: 1023px), (pointer: coarse)");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const linkedSections = sectionLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);
let currentSectionId = location.hash.slice(1) || "about";
let lastAffordanceSectionId = null;
let pageAnimationFrame = null;
const pageAffordanceLimit = 3;

const getPageAffordanceViews = () => Number(sessionStorage.getItem("pageAffordanceViews") || "0");

const setPageAffordance = (id) => {
  if (!phonePageQuery.matches) {
    document.body.classList.remove("show-page-affordance");
    return;
  }

  let views = getPageAffordanceViews();
  const shouldShow = views < pageAffordanceLimit;
  document.body.classList.toggle("show-page-affordance", shouldShow);

  if (!shouldShow || !id || id === lastAffordanceSectionId) return;

  lastAffordanceSectionId = id;
  views += 1;
  sessionStorage.setItem("pageAffordanceViews", String(views));

  if (views >= pageAffordanceLimit) {
    window.setTimeout(() => {
      document.body.classList.remove("show-page-affordance");
    }, 1300);
  }
};

const scrollActiveSectionLink = (activeLink) => {
  if (!phonePageQuery.matches || !activeLink) return;
  const nav = activeLink.closest(".section-nav");
  if (!nav) return;

  const navRect = nav.getBoundingClientRect();
  const linkRect = activeLink.getBoundingClientRect();
  const left = nav.scrollLeft + linkRect.left - navRect.left - (navRect.width - linkRect.width) / 2;

  nav.scrollTo({
    left: Math.max(0, left),
    behavior: reducedMotionQuery.matches ? "auto" : "smooth",
  });
};

const setActiveSection = (id) => {
  if (!id) return;
  currentSectionId = id;
  let activeLink = null;
  sectionLinks.forEach((link) => {
    const isActive = link.getAttribute("href") === `#${id}`;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      activeLink = link;
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
  scrollActiveSectionLink(activeLink);
  setPageAffordance(id);
};

const replaceSectionHash = (id) => {
  if (!id || location.hash === `#${id}`) return;
  history.replaceState(null, "", `#${id}`);
};

if ("IntersectionObserver" in window && linkedSections.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (visible) setActiveSection(visible.target.id);
    },
    { rootMargin: "-35% 0px -45% 0px", threshold: [0.1, 0.35, 0.6] },
  );

  linkedSections.forEach((section) => observer.observe(section));
}

const pageTargets = [document.querySelector(".hero"), ...document.querySelectorAll("main > .section")].filter(Boolean);
let pageSwipeStart = null;
let pageSwipeLast = null;
let pageScrollFrame = null;
let windowScrollFrame = null;
let pullRefreshStart = null;
const pullRefreshThreshold = 82;

const getSectionById = (id) => pageTargets.find((section) => section.id === id) || null;

const getHashSection = () => {
  if (!location.hash) return null;

  try {
    return getSectionById(decodeURIComponent(location.hash.slice(1)));
  } catch {
    return null;
  }
};

const syncSection = (section, updateHash = false) => {
  if (!section?.id) return;
  setActiveSection(section.id);
  if (updateHash) replaceSectionHash(section.id);
};

const getCurrentPageIndex = () => {
  if (pagedModeQuery.matches && pageTrack) {
    return pageTargets.reduce(
      (closest, section, index) => {
        const distance = Math.abs(section.offsetLeft - pageTrack.scrollLeft);
        return distance < closest.distance ? { index, distance } : closest;
      },
      { index: 0, distance: Number.POSITIVE_INFINITY },
    ).index;
  }

  const viewportCenter = window.innerHeight / 2;
  return pageTargets.reduce(
    (closest, section, index) => {
      const rect = section.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
      return distance < closest.distance ? { index, distance } : closest;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  ).index;
};

const animatePageScroll = (left) => {
  if (!pageTrack) return;

  if (pageAnimationFrame) {
    cancelAnimationFrame(pageAnimationFrame);
    pageAnimationFrame = null;
    pageTrack.style.scrollSnapType = "";
  }

  const start = pageTrack.scrollLeft;
  const distance = left - start;
  const duration = 360;
  const startedAt = performance.now();
  const previousSnapType = pageTrack.style.scrollSnapType;
  pageTrack.style.scrollSnapType = "none";

  const step = (time) => {
    const progress = Math.min((time - startedAt) / duration, 1);
    const eased = 1 - (1 - progress) ** 3;
    pageTrack.scrollLeft = start + distance * eased;

    if (progress < 1) {
      pageAnimationFrame = requestAnimationFrame(step);
      return;
    }

    pageTrack.scrollLeft = left;
    pageTrack.style.scrollSnapType = previousSnapType;
    pageAnimationFrame = null;
  };

  pageAnimationFrame = requestAnimationFrame(step);
};

const scrollToPage = (section, behavior = "smooth") => {
  if (!section) return;

  if (pagedModeQuery.matches && pageTrack) {
    if (behavior === "auto" || behavior === "instant") {
      if (pageAnimationFrame) {
        cancelAnimationFrame(pageAnimationFrame);
        pageAnimationFrame = null;
        pageTrack.style.scrollSnapType = "";
      }
      pageTrack.scrollLeft = section.offsetLeft;
      return;
    }

    if (touchPageQuery.matches && !reducedMotionQuery.matches) {
      animatePageScroll(section.offsetLeft);
      return;
    }

    pageTrack.scrollTo({ left: section.offsetLeft, behavior });
    return;
  }

  section.scrollIntoView({ behavior, block: "start" });
};

const syncCurrentPage = (updateHash = false) => {
  syncSection(pageTargets[getCurrentPageIndex()], updateHash);
};

const goToPageByOffset = (offset) => {
  if (!pagedModeQuery.matches) return;
  const currentIndex = getCurrentPageIndex();
  const nextIndex = Math.max(0, Math.min(pageTargets.length - 1, currentIndex + offset));
  if (nextIndex === currentIndex) return;

  const nextSection = pageTargets[nextIndex];
  syncSection(nextSection, true);
  scrollToPage(nextSection);
};

sectionLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    if (!pagedModeQuery.matches) return;
    const section = document.querySelector(link.getAttribute("href"));
    if (!section) return;

    event.preventDefault();
    syncSection(section, true);
    scrollToPage(section);
  });
});

// Jump to a specific project: open the Projects page, then scroll inside it.
document.querySelectorAll("[data-project-link]").forEach((link) => {
  link.addEventListener("click", (event) => {
    const section = document.querySelector(link.getAttribute("href"));
    const target = document.querySelector(link.dataset.projectLink);
    if (!section || !target) return;

    event.preventDefault();
    // Set the vertical position instantly: a smooth scroll here gets cancelled by the page slide.
    const top = section.scrollTop + target.getBoundingClientRect().top - section.getBoundingClientRect().top - 12;
    section.scrollTop = Math.max(0, top);
    syncSection(section, true);
    scrollToPage(section);
  });
});

pageEdgeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    goToPageByOffset(button.getAttribute("data-page-edge") === "next" ? 1 : -1);
  });
});

pageTrack?.addEventListener(
  "scroll",
  () => {
    if (!pagedModeQuery.matches || pageScrollFrame) return;

    pageScrollFrame = requestAnimationFrame(() => {
      pageScrollFrame = null;
      syncCurrentPage(true);
    });
  },
  { passive: true },
);

window.addEventListener(
  "scroll",
  () => {
    if (pagedModeQuery.matches || windowScrollFrame) return;

    windowScrollFrame = requestAnimationFrame(() => {
      windowScrollFrame = null;
      syncCurrentPage(true);
    });
  },
  { passive: true },
);

const isPullRefreshExcluded = (target) =>
  target.closest(
    "a, button, summary, input, textarea, select, [data-slider], .image-modal, .section-nav, .mobile-social-footer, .footer, .page-edge",
  );

const setPullRefreshProgress = (distance, isReady = false) => {
  if (!pullRefresh) return;
  pullRefresh.classList.add("is-visible");
  pullRefresh.classList.toggle("is-ready", isReady);
  pullRefresh.style.setProperty("--pull-distance", `${distance}px`);
  pullRefresh.style.setProperty("--pull-rotation", `${Math.min(distance * 3, 180)}deg`);
};

const resetPullRefresh = () => {
  if (!pullRefresh) return;
  pullRefresh.classList.remove("is-visible", "is-ready", "is-refreshing");
  pullRefresh.style.removeProperty("--pull-distance");
  pullRefresh.style.removeProperty("--pull-rotation");
};

const triggerPullRefresh = () => {
  if (!pullRefresh) return;
  pullRefresh.classList.add("is-visible", "is-refreshing");
  pullRefresh.classList.remove("is-ready");
  pullRefresh.style.setProperty("--pull-distance", "86px");
  window.setTimeout(() => window.location.reload(), 220);
};

const beginPullRefresh = (clientX, clientY, target) => {
  if (!phonePageQuery.matches || !pageTrack || !modal?.hidden || isPullRefreshExcluded(target)) {
    pullRefreshStart = null;
    return;
  }

  const currentPage = pageTargets[getCurrentPageIndex()];
  if (!currentPage || currentPage.scrollTop > 1) {
    pullRefreshStart = null;
    return;
  }

  pullRefreshStart = {
    x: clientX,
    y: clientY,
    page: currentPage,
  };
};

const updatePullRefresh = (clientX, clientY, event) => {
  if (!pullRefreshStart || !phonePageQuery.matches) return;

  const deltaX = clientX - pullRefreshStart.x;
  const deltaY = clientY - pullRefreshStart.y;

  if (deltaY < 0 || Math.abs(deltaX) > deltaY * 1.15 || pullRefreshStart.page.scrollTop > 1) {
    pullRefreshStart = null;
    resetPullRefresh();
    return;
  }

  if (deltaY < 12) return;

  event.preventDefault();
  pageSwipeStart = null;
  pageSwipeLast = null;

  const distance = Math.min(deltaY * 0.58, 112);
  pullRefreshStart.ready = distance >= pullRefreshThreshold;
  setPullRefreshProgress(distance, pullRefreshStart.ready);
};

document.addEventListener(
  "touchstart",
  (event) => {
    if (event.touches.length !== 1) {
      pullRefreshStart = null;
      return;
    }

    const touch = event.touches[0];
    beginPullRefresh(touch.clientX, touch.clientY, event.target);
  },
  { passive: true },
);

document.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    updatePullRefresh(touch.clientX, touch.clientY, event);
  },
  { passive: false },
);

const finishPullRefresh = () => {
  if (!pullRefreshStart) return;
  const shouldRefresh = pullRefreshStart.ready;
  pullRefreshStart = null;

  if (shouldRefresh) {
    triggerPullRefresh();
    return;
  }

  resetPullRefresh();
};

document.addEventListener("touchend", finishPullRefresh, { passive: true });
document.addEventListener("touchcancel", finishPullRefresh, { passive: true });

const isPageSwipeExcluded = (target) => {
  if (target.closest(".page-edge")) return false;

  return target.closest(
    "a, button, summary, input, textarea, select, [data-slider], .image-modal, .section-nav, .mobile-social-footer, .footer",
  );
};

const beginPageSwipe = (clientX, clientY, target) => {
  if (!pagedModeQuery.matches || !pageTrack || isPageSwipeExcluded(target)) {
    pageSwipeStart = null;
    pageSwipeLast = null;
    return;
  }

  pageSwipeStart = {
    x: clientX,
    y: clientY,
    index: getCurrentPageIndex(),
    axis: null,
    scrollLeft: pageTrack.scrollLeft,
  };
  pageSwipeLast = { x: clientX, y: clientY };
};

const updatePageSwipe = (clientX, clientY, event) => {
  if (!pageSwipeStart) return;

  pageSwipeLast = { x: clientX, y: clientY };

  const deltaX = clientX - pageSwipeStart.x;
  const deltaY = clientY - pageSwipeStart.y;

  if (!pageSwipeStart.axis && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
    pageSwipeStart.axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.15 ? "x" : "y";
  }

  if (pageSwipeStart.axis === "x" && event?.cancelable) {
    event.preventDefault();
  }
};

const finishPageSwipe = (clientX, clientY, event) => {
  if (!pageSwipeStart || !pagedModeQuery.matches) return;

  const startIndex = pageSwipeStart.index;
  const axis = pageSwipeStart.axis;
  const deltaX = clientX - pageSwipeStart.x;
  const deltaY = clientY - pageSwipeStart.y;
  const nativeScrollDelta = pageTrack ? Math.abs(pageTrack.scrollLeft - pageSwipeStart.scrollLeft) : 0;
  pageSwipeStart = null;
  pageSwipeLast = null;

  if (nativeScrollDelta > 24 && axis !== "x") return;

  const isHorizontalSwipe = Math.abs(deltaX) > 64 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35;
  if (!isHorizontalSwipe) return;

  if (event.cancelable) event.preventDefault();

  const nextIndex = deltaX < 0 ? startIndex + 1 : startIndex - 1;
  const nextSection = pageTargets[Math.max(0, Math.min(pageTargets.length - 1, nextIndex))];
  syncSection(nextSection, true);
  scrollToPage(nextSection);
};

document.addEventListener(
  "pointerdown",
  (event) => {
    beginPageSwipe(event.clientX, event.clientY, event.target);
  },
  { passive: true },
);

document.addEventListener(
  "pointerup",
  (event) => {
    finishPageSwipe(event.clientX, event.clientY, event);
  },
  { passive: false },
);

document.addEventListener(
  "touchstart",
  (event) => {
    if (event.touches.length !== 1) {
      pageSwipeStart = null;
      pageSwipeLast = null;
      return;
    }

    const touch = event.touches[0];
    beginPageSwipe(touch.clientX, touch.clientY, event.target);
  },
  { passive: true },
);

document.addEventListener(
  "touchend",
  (event) => {
    const touch = event.changedTouches[0];
    const point = touch ? { x: touch.clientX, y: touch.clientY } : pageSwipeLast;
    if (!point) return;
    finishPageSwipe(point.x, point.y, event);
  },
  { passive: false },
);

document.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    updatePageSwipe(touch.clientX, touch.clientY, event);
  },
  { passive: false },
);

document.addEventListener(
  "touchcancel",
  () => {
    pageSwipeStart = null;
    pageSwipeLast = null;
  },
  { passive: true },
);

window.addEventListener("hashchange", () => {
  const section = getHashSection();
  if (!section) return;
  syncSection(section);
  if (pagedModeQuery.matches) scrollToPage(section);
});

const syncInitialPage = () => {
  const section = getHashSection() || pageTargets[0];
  if (!section) return;
  syncSection(section, Boolean(location.hash));
  if (pagedModeQuery.matches) scrollToPage(section, "auto");
};

requestAnimationFrame(syncInitialPage);
window.addEventListener("pageshow", syncInitialPage);
window.addEventListener("load", () => {
  requestAnimationFrame(() => {
    syncInitialPage();
  });
});
