(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
  var RESUME = 7000;

  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function Carousel(el) {
    var self = this;
    this.el = el;
    this.items = Array.prototype.slice.call(el.children);
    this.dur = +el.getAttribute('data-auto') || 0;
    this.idx = 0;
    this.visible = false;
    this.hover = false;
    this.resumeAt = 0;
    this.timer = null;
    this.anim = null;
    this.build();
    this.check();

    el.addEventListener('scroll', function () {
      clearTimeout(self.st);
      self.st = setTimeout(function () { self.sync(); }, 90);
    }, { passive: true });

    var touch = function () { self.userMoved(); };
    el.addEventListener('touchstart', touch, { passive: true });
    el.addEventListener('wheel', function (e) { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) touch(); }, { passive: true });
    if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      el.addEventListener('mouseenter', function () { self.hover = true; self.plan(); });
      el.addEventListener('mouseleave', function () { self.hover = false; self.plan(); });
    }
    this.drag();

    if (hasIO) {
      new IntersectionObserver(function (en) {
        self.visible = en[0].isIntersecting;
        self.plan();
      }, { threshold: .55 }).observe(el);
    } else {
      this.visible = true;
    }
    window.addEventListener('resize', function () { self.check(); self.sync(); });
    document.addEventListener('visibilitychange', function () { self.plan(); });
  }

  Carousel.prototype.build = function () {
    var self = this;
    var bar = document.createElement('div');
    bar.className = 'rail';
    var track = document.createElement('div');
    track.className = 'rail__track';
    this.segs = this.items.map(function (it, i) {
      var s = document.createElement('button');
      s.type = 'button';
      s.className = 'rail__seg';
      s.setAttribute('aria-label', 'Фото ' + (i + 1));
      s.style.setProperty('--dur', (self.dur || 3000) + 'ms');
      s.appendChild(document.createElement('b'));
      s.addEventListener('click', function () { self.userMoved(); self.go(i); });
      track.appendChild(s);
      return s;
    });
    var count = document.createElement('span');
    count.className = 'rail__count';
    var prev = document.createElement('button');
    prev.type = 'button'; prev.className = 'rail__btn rail__prev'; prev.setAttribute('aria-label', 'Назад'); prev.innerHTML = '&larr;';
    var next = document.createElement('button');
    next.type = 'button'; next.className = 'rail__btn rail__next'; next.setAttribute('aria-label', 'Дальше'); next.innerHTML = '&rarr;';
    prev.addEventListener('click', function () { self.userMoved(); self.go(Math.max(0, self.idx - 1)); });
    next.addEventListener('click', function () { self.userMoved(); self.go(self.idx >= self.items.length - 1 ? 0 : self.idx + 1); });
    bar.appendChild(track); bar.appendChild(count); bar.appendChild(prev); bar.appendChild(next);
    this.el.parentNode.insertBefore(bar, this.el.nextSibling);
    this.bar = bar; this.count = count; this.prev = prev; this.next = next;
    this.paint(false);
  };

  // Лента может помещаться целиком (например, сетка на компьютере): тогда рельс не нужен
  Carousel.prototype.check = function () {
    this.active = this.el.scrollWidth > this.el.clientWidth + 8;
    this.bar.style.display = this.active ? '' : 'none';
    this.el.classList.toggle('is-carousel', this.active);
    this.plan();
  };

  Carousel.prototype.pos = function (i) {
    var first = this.items[0].offsetLeft;
    var max = this.el.scrollWidth - this.el.clientWidth;
    return Math.min(max, Math.max(0, this.items[i].offsetLeft - first));
  };

  Carousel.prototype.sync = function () {
    var x = this.el.scrollLeft, best = 0, bd = Infinity, max = this.el.scrollWidth - this.el.clientWidth;
    for (var i = 0; i < this.items.length; i++) {
      var d = Math.abs(this.pos(i) - x);
      if (d < bd) { bd = d; best = i; }
    }
    if (x >= max - 4 && this.idx > best) best = this.idx;
    if (best !== this.idx) { this.idx = best; this.paint(this.playing()); }
  };

  Carousel.prototype.playing = function () {
    return !!this.dur && !reduce && this.active && this.visible && !this.hover && !document.hidden && Date.now() >= this.resumeAt;
  };

  Carousel.prototype.paint = function (animate) {
    var self = this;
    this.segs.forEach(function (s, i) {
      s.classList.toggle('is-done', i < self.idx);
      s.classList.remove('is-on');
    });
    var on = this.segs[this.idx];
    void on.offsetWidth;
    on.classList.add('is-on');
    this.bar.classList.toggle('is-manual', !animate);
    this.count.textContent = (this.idx + 1) + ' / ' + this.items.length;
    this.prev.disabled = this.idx === 0;
  };

  Carousel.prototype.go = function (i) {
    var self = this, el = this.el;
    this.idx = i;
    var from = el.scrollLeft, to = this.pos(i), t0 = null, d = Math.min(900, 380 + Math.abs(to - from) * .6);
    if (this.anim) this.anim.stop = true;
    var a = this.anim = { stop: false };
    el.style.scrollSnapType = 'none';
    el.style.webkitScrollSnapType = 'none';
    function step(t) {
      if (a.stop) return;
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / d);
      el.scrollLeft = from + (to - from) * ease(p);
      if (p < 1) raf(step);
      else { el.style.scrollSnapType = ''; el.style.webkitScrollSnapType = ''; }
    }
    if (reduce) { el.scrollLeft = to; el.style.scrollSnapType = ''; el.style.webkitScrollSnapType = ''; }
    else raf(step);
    this.paint(this.playing());
    this.plan();
  };

  Carousel.prototype.userMoved = function () {
    this.resumeAt = Date.now() + RESUME;
    this.bar.classList.add('is-manual');
    this.plan();
  };

  Carousel.prototype.plan = function () {
    var self = this;
    clearTimeout(this.timer);
    if (!this.dur || reduce || !this.active) return;
    if (this.playing()) {
      if (this.bar.classList.contains('is-manual')) this.paint(true);
      this.timer = setTimeout(function () {
        if (!self.playing()) return self.plan();
        self.go(self.idx >= self.items.length - 1 ? 0 : self.idx + 1);
      }, this.dur);
    } else if (this.visible && Date.now() < this.resumeAt) {
      this.timer = setTimeout(function () { self.plan(); }, this.resumeAt - Date.now() + 50);
    }
  };

  // Перетаскивание мышью на компьютере
  Carousel.prototype.drag = function () {
    var self = this, el = this.el, down = false, sx = 0, sl = 0, moved = false;
    el.addEventListener('mousedown', function (e) {
      if (!self.active || e.button !== 0) return;
      down = true; moved = false; sx = e.clientX; sl = el.scrollLeft;
      if (self.anim) self.anim.stop = true;
      el.style.scrollSnapType = 'none';
      el.classList.add('is-drag');
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!down) return;
      var dx = e.clientX - sx;
      if (Math.abs(dx) > 4) moved = true;
      el.scrollLeft = sl - dx;
    });
    window.addEventListener('mouseup', function () {
      if (!down) return;
      down = false;
      el.classList.remove('is-drag');
      self.userMoved();
      self.sync();
      self.go(self.idx);
    });
    el.addEventListener('click', function (e) {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
    }, true);
  };

  window.RigsCarousel = function (el) { return el.children.length > 1 ? new Carousel(el) : null; };

  var list = Array.prototype.slice.call(document.querySelectorAll('[data-carousel]'));
  list.forEach(function (el) { if (el.children.length > 1) new Carousel(el); });
})();
