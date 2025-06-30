// GhostRev MVP Scoring Engine (Shopify Optimized)
// Version: MVP 1.7
// Description: In-browser classification engine for identifying ghost vs buyer traffic on Shopify stores with improved idle-aware time scoring

(function () {
  const GhostRev = {
    score: 0,
    locked: false,
    triggered: false,
    debug: true,
    cooldownMs: 15000,
    layer1Evaluated: false,
    evaluationTime: Date.now(),
    sessionKey: "ghostrev_score",
    userInteracted: false,
    lastLog: {
      layer1: null,
      layer2: null,
      final: null
    },

    loadSessionScore() {
      const stored = sessionStorage.getItem(this.sessionKey);
      if (stored) {
        this.score = parseInt(stored, 10) || 0;
      }
    },

    saveSessionScore() {
      sessionStorage.setItem(this.sessionKey, this.score.toString());
    },

    evaluateLayer1() {
      let s = 0;
      let reasons = [];

      const url = window.location.href;
      const ref = document.referrer;
      const isMobile = /Mobi|Android/i.test(navigator.userAgent);
      const customer = window.Shopify && Shopify.customer;
      const pathname = window.location.pathname;

      if (/\/products\//i.test(pathname)) {
        s += 2;
        reasons.push("+2: Landed on product page");
      }
      if (/\/blogs|\/about|\/home|\/pages\//i.test(pathname)) {
        s -= 2;
        reasons.push("-2: Landed on non-commercial page");
      }

      if (!sessionStorage.getItem("ghostrev_ref_scored")) {
        if (/google|bing\./i.test(ref)) {
          s += 2;
          reasons.push("+2: Referrer is search engine");
        }
        if (/pinterest|reddit|instagram|tiktok/i.test(ref)) {
          s -= 2;
          reasons.push("-2: Referrer is low-intent social");
        }
        sessionStorage.setItem("ghostrev_ref_scored", "1");
      }

      if (!sessionStorage.getItem("ghostrev_device_scored")) {
        if (isMobile) {
          s -= 1;
          reasons.push("-1: Mobile session");
        } else {
          s += 1;
          reasons.push("+1: Desktop session");
        }
        sessionStorage.setItem("ghostrev_device_scored", "1");
      }

      if (ref.includes('utm_source=facebook') && !sessionStorage.getItem("ghostrev_utm_scored")) {
        s -= 2;
        reasons.push("-2: Facebook UTM tag detected");
        sessionStorage.setItem("ghostrev_utm_scored", "1");
      }

      if (customer && !sessionStorage.getItem("ghostrev_login_scored")) {
        s += 5;
        reasons.push("+5: Logged-in Shopify customer");
        this.lock("Logged in Shopify customer");
        sessionStorage.setItem("ghostrev_login_scored", "1");
      }

      this.score += s;
      this.saveSessionScore();
      this.layer1Evaluated = true;

      if (this.debug && this.lastLog.layer1 !== s) {
        console.group("[GhostRev] Layer 1 Evaluation");
        reasons.forEach(r => console.log(r));
        console.log("Layer 1 Delta:", s);
        console.log("Total Score:", this.score, "→ Status:", this.getClassification());
        console.groupEnd();
        this.lastLog.layer1 = s;
      }

      if (this.score <= -3) this.triggerAd("Layer 1: Strong ghost signal");
    },

    setupLayer2Tracking() {
      let scrollDepth = 0;
      let hoveredElements = new Set();
      const path = window.location.pathname;

      document.addEventListener("mousemove", () => { this.userInteracted = true; }, { once: true });
      document.addEventListener("click", () => { this.userInteracted = true; }, { once: true });

      const now = Date.now();
      const history = JSON.parse(sessionStorage.getItem("ghostrev_nav") || "[]");
      history.push({ time: now, path });
      sessionStorage.setItem("ghostrev_nav", JSON.stringify(history.slice(-10)));
      const recent = history.slice(-3);
      if (recent.length === 3 && (recent[2].time - recent[0].time < 20000) && !sessionStorage.getItem("ghostrev_skips_scored")) {
        this.score -= 3;
        sessionStorage.setItem("ghostrev_skips_scored", "1");
        this.saveSessionScore();
        if (this.debug) {
          console.group("[GhostRev] Layer 2 Interaction");
          console.log("-3: Skipped 3+ pages in < 20s");
          console.log("Total Score:", this.score, "→ Status:", this.getClassification());
          console.groupEnd();
        }
      }

      setTimeout(() => {
        if ((hoveredElements.size > 0 || this.userInteracted) && !sessionStorage.getItem("ghostrev_30s_scored")) {
          this.score += 1;
          sessionStorage.setItem("ghostrev_30s_scored", "1");
          this.saveSessionScore();
          if (this.debug) {
            console.group("[GhostRev] Layer 2 Interaction");
            console.log("+1: Stayed on page > 30s with engagement");
            console.log("Total Score:", this.score, "→ Status:", this.getClassification());
            console.groupEnd();
          }
        }
      }, 30000);

      if (/\/products\//i.test(path)) {
        setTimeout(() => {
          if (!sessionStorage.getItem("ghostrev_60s_product_scored")) {
            this.score += 2;
            sessionStorage.setItem("ghostrev_60s_product_scored", "1");
            this.saveSessionScore();
            if (this.debug) {
              console.group("[GhostRev] Layer 2 Interaction");
              console.log("+2: Stayed on product page > 60s");
              console.log("Total Score:", this.score, "→ Status:", this.getClassification());
              console.groupEnd();
            }
          }
        }, 60000);
      }

      setTimeout(() => {
        if (hoveredElements.size === 0 && !sessionStorage.getItem("ghostrev_idle60_scored")) {
          this.score -= 3;
          sessionStorage.setItem("ghostrev_idle60_scored", "1");
          this.saveSessionScore();
          if (this.debug) {
            console.group("[GhostRev] Layer 2 Interaction");
            console.log("-3: No hover or interaction after 60s");
            console.log("Total Score:", this.score, "→ Status:", this.getClassification());
            console.groupEnd();
          }
        }
      }, 60000);

      let scrollStartTime = Date.now();
      let fastScrolled = false;
      window.addEventListener("scroll", () => {
        const currentScroll = window.scrollY + window.innerHeight;
        const maxScroll = document.body.scrollHeight;
        const now = Date.now();
        if (!fastScrolled && (currentScroll / maxScroll > 0.95) && (now - scrollStartTime < 5000)) {
          fastScrolled = true;
          if (!sessionStorage.getItem("ghostrev_scrollfast_scored")) {
            this.score -= 2;
            sessionStorage.setItem("ghostrev_scrollfast_scored", "1");
            this.saveSessionScore();
            if (this.debug) {
              console.group("[GhostRev] Layer 2 Interaction");
              console.log("-2: Rapid scroll down entire page in <5s");
              console.log("Total Score:", this.score, "→ Status:", this.getClassification());
              console.groupEnd();
            }
          }
        }
      });

      document.addEventListener("click", (e) => {
        const path = window.location.pathname;
        if (/\/blogs|\/pages|\/contact/i.test(path) && !sessionStorage.getItem("ghostrev_noncommerce_scored")) {
          this.score -= 2;
          sessionStorage.setItem("ghostrev_noncommerce_scored", "1");
          this.saveSessionScore();
          if (this.debug) {
            console.group("[GhostRev] Layer 2 Interaction");
            console.log("-2: Clicked on non-commerce page");
            console.log("Total Score:", this.score, "→ Status:", this.getClassification());
            console.groupEnd();
          }
        }
        if (
          e.target.matches("button[name='add']") ||
          (e.target.closest("form[action*='/cart/add']") && e.target.type === "submit")
        ) {
          this.lock("Shopify Add to Cart");
        }
        if (e.target.name && e.target.name.includes("variant")) {
          this.lock("Shopify Variant Selection");
        }
      });

      document.addEventListener("mouseover", (e) => {
        const el = e.target.closest("img, .product__price, .product-form, .product__title, button, select, .product-card, .grid-product, .product-grid-item, .product-tile");
        if (el && !hoveredElements.has(el)) {
          hoveredElements.add(el);
          let hoverTimer = setTimeout(() => {
            this.score += 2;
            this.saveSessionScore();
            if (this.debug && this.lastLog.layer2 !== 'hover-' + hoveredElements.size) {
              console.group("[GhostRev] Layer 2 Interaction");
              console.log("+2: Hovered on product-related element for >1s");
              console.log("Total Score:", this.score, "→ Status:", this.getClassification());
              console.groupEnd();
              this.lastLog.layer2 = 'hover-' + hoveredElements.size;
            }
          }, 1000);

          el.addEventListener("mouseleave", () => clearTimeout(hoverTimer), { once: true });
        }
      });

      setTimeout(() => {
        if (!this.locked && !this.triggered && this.score <= 0) {
          this.triggerAd("Layer 2: Low interaction after cooldown");
        }
        this.showStickyAd(); // Trigger sticky ad if ghost
      }, this.cooldownMs);
    },

    lock(reason) {
      this.locked = true;
      if (this.debug && this.lastLog.final !== reason) {
        console.log(`[GhostRev] Monetization locked: ${reason}`);
        this.lastLog.final = reason;
      }
    },

    triggerAd(reason) {
      if (this.triggered || this.locked) return;
      this.triggered = true;
      if (this.debug && this.lastLog.final !== reason) {
        console.group(`[GhostRev] Ad Triggered`);
        console.log("Reason:", reason);
        console.log("Final Score:", this.score, "→ Status:", this.getClassification());
        console.groupEnd();
        this.lastLog.final = reason;
      }

      const ad = document.createElement("div");
      ad.style.position = "fixed";
      ad.style.top = 0;
      ad.style.left = 0;
      ad.style.width = "100vw";
      ad.style.height = "100vh";
      ad.style.backgroundColor = "rgba(0,0,0,0.8)";
      ad.style.zIndex = 9999;
      ad.innerHTML = '<div style="color:#fff;text-align:center;margin-top:20%;font-size:24px">Interstitial Ad Placeholder</div>';
      document.body.appendChild(ad);

      setTimeout(() => ad.remove(), 10000);
    },

    showStickyAd() {
      if (this.locked || this.triggered || sessionStorage.getItem("ghostrev_sticky_shown")) return;
      if (this.getClassification() !== "Likely Ghost") return;

      const bar = document.createElement("div");
      bar.id = "ghostrev-sticky-ad";
      bar.style.position = "fixed";
      bar.style.bottom = "0";
      bar.style.left = "0";
      bar.style.width = "100%";
      bar.style.backgroundColor = "#111";
      bar.style.color = "#fff";
      bar.style.textAlign = "center";
      bar.style.padding = "12px";
      bar.style.zIndex = "9998";
      bar.style.fontSize = "16px";
      bar.innerText = "Ad: This visitor will not convert — monetize them without hurting conversions.";

      document.body.appendChild(bar);
      sessionStorage.setItem("ghostrev_sticky_shown", "1");

      if (this.debug) {
        console.log("[GhostRev] Sticky bottom ad shown for ghost user");
      }
    },

    getClassification() {
      if (this.score >= 7) return "High-Intent Buyer";
      if (this.score >= 2) return "Potential Buyer";
      return "Likely Ghost";
    },

    init() {
      if (this.debug) console.log("[GhostRev] Engine starting for Shopify site...");
      this.loadSessionScore();
      this.evaluateLayer1();
      this.setupLayer2Tracking();
    }
  };

  window.GhostRev = GhostRev;
  GhostRev.init();
})();
