/* ============================================================
   OverSpeed · app.js
   Reconstruido a partir de supabase/schema.sql.
   Capas: config → datos (supabase | demo) → vistas.
   El cálculo vive en core.js (window.OS); aquí no se duplica.
   ============================================================ */
(function () {
  'use strict';

  var OS = window.OS;
  var $ = function (id) { return document.getElementById(id); };
  var esc = OS.esc, money = OS.money;
  var CONFIG_KEY = 'overspeed-config';
  var DEMO_KEY = 'overspeed-demo';
  /* Supabase autentica siempre con un correo. Como el personal del taller no
     tiene direcciones corporativas, la interfaz pide un usuario y aqui se le
     anade este dominio. Nadie escribe ni ve el correo completo. */
  var USER_DOMAIN = 'overspeed.com';

  function toEmail(value) {
    var clean = String(value || '').trim().toLowerCase();
    if (!clean) return '';
    return clean.indexOf('@') >= 0 ? clean : clean + '@' + USER_DOMAIN;
  }
  function toUser(email) {
    var clean = String(email || '').trim();
    var suffix = '@' + USER_DOMAIN;
    return clean.slice(-suffix.length).toLowerCase() === suffix
      ? clean.slice(0, -suffix.length)
      : clean;
  }

  var CATEGORIES = ['Mantenimiento', 'Motor', 'Frenos', 'Ruedas', 'Estética', 'Tracción', 'Paquetes'];
  var PAYMENTS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'];
  var CARET_UP = '<svg viewBox="0 0 10 6"><path d="M1 5l4-4 4 4"/></svg>';
  var CARET_DOWN = '<svg viewBox="0 0 10 6"><path d="M1 1l4 4 4-4"/></svg>';
  var PLUS = '<svg viewBox="0 0 14 14"><path d="M7 1.5v11M1.5 7h11"/></svg>';
  var CROSS = '<svg viewBox="0 0 14 14"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg>';

  var state = {
    mode: null,            // 'supabase' | 'demo'
    client: null,
    me: null,              // perfil activo { id, name, email, role, commission, active }
    services: [], discounts: [], orders: [], profiles: [], payouts: [], audit: [],
    featured: null,
    cart: {}, discountId: '',
    view: 'dashboard',
    historyPage: 0,
    demoRole: 'admin'
  };
  var PAGE = 20;

  /* ======================= utilidades ======================= */
  function toast(message, isError) {
    var el = $('toast');
    el.textContent = message;
    el.classList.toggle('danger', !!isError);
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }
  function fail(error) {
    var message = (error && (error.message || error.error_description)) || String(error);
    toast(message, true);
    return null;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function dateOnly(value) { return new Date(value).toISOString().slice(0, 10); }
  function shortDate(value) {
    return new Date(value).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function daysAgo(n) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; }

  /* ==================== configuración ======================= */
  function readConfig() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'); } catch (e) { saved = null; }
    var base = window.OVERSPEED_CONFIG || {};
    return {
      supabaseUrl: (saved && saved.supabaseUrl) || base.supabaseUrl || '',
      supabaseAnonKey: (saved && saved.supabaseAnonKey) || base.supabaseAnonKey || ''
    };
  }
  function makeClient() {
    var cfg = readConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
    return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }

  /* ================== capa de datos: demo ===================
     Reproduce en el navegador lo que hacen las funciones RPC,
     incluidas sus validaciones, para poder probar sin backend. */
  var demo = {
    load: function () {
      var raw = null;
      try { raw = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch (e) { raw = null; }
      if (!raw) { raw = demo.seed(); demo.save(raw); }
      return raw;
    },
    save: function (data) { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); },
    reset: function () { localStorage.removeItem(DEMO_KEY); return demo.load(); },
    seed: function () {
      var services = (window.OS_CATALOG || []).slice();
      var profiles = [
        { id: 'demo-admin', name: 'Marco Ruiz', email: 'marco@overspeed.mx', role: 'admin', commission: 12, active: true },
        { id: 'demo-emp-1', name: 'Ana Torres', email: 'ana@overspeed.mx', role: 'employee', commission: 10, active: true },
        { id: 'demo-emp-2', name: 'Javier Gómez', email: 'javier@overspeed.mx', role: 'employee', commission: 8, active: true }
      ];
      var clients = [
        ['Lucía Fernández', 'OS-2048', 'Nissan GTR R34'], ['Carlos Méndez', 'TRX-119', 'Dodge Charger'],
        ['Diego Torres', 'VLM-902', 'Toyota Supra MK4'], ['María López', 'QRT-418', 'Ford Mustang GT'],
        ['Sofía Martínez', 'KDR-770', 'BMW M3 E46'], ['Hugo Ramírez', 'PLN-355', 'Subaru WRX STI']
      ];
      var orders = [];
      for (var i = 0; i < 46; i++) {
        var who = profiles[Math.floor(Math.random() * profiles.length)];
        var c = clients[Math.floor(Math.random() * clients.length)];
        var cart = {};
        var howMany = 1 + Math.floor(Math.random() * 3);
        for (var k = 0; k < howMany; k++) {
          var s = services[Math.floor(Math.random() * services.length)];
          cart[s.id] = 1 + Math.floor(Math.random() * 2);
        }
        var when = daysAgo(Math.floor(Math.random() * 42));
        when.setHours(9 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60), 0, 0);
        var calc;
        try { calc = OS.calculate(services, cart, 0, who.commission); } catch (e) { continue; }
        orders.push({
          id: uuid(), number: 1000 + i, request_id: uuid(),
          employee_id: who.id, employee_name: who.name,
          client: c[0], plate: c[1], model: c[2],
          payment: PAYMENTS[Math.floor(Math.random() * PAYMENTS.length)], note: '',
          items: calc.lines.map(function (l) {
            return { id: l.id, name: l.name, category: l.category, qty: l.qty, price: l.price, cost: l.cost, line_total: l.line_total, line_cost: l.line_cost, cost_confirmed: l.cost_confirmed !== false };
          }),
          subtotal: calc.subtotal, cost: calc.cost, cost_confirmed: calc.costConfirmed,
          discount: 0, discount_name: 'Sin convenio', total: calc.total,
          commission_percent: who.commission, earning: calc.earning, net: calc.net,
          status: Math.random() < 0.06 ? 'void' : 'active',
          void_reason: null, payout_id: null,
          created_at: when.toISOString(), updated_at: when.toISOString()
        });
      }
      orders.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      return {
        profiles: profiles, services: services,
        discounts: [
          { id: 'd5', name: 'Autorizado 5%', percent: 5, active: true, admin_only: true },
          { id: 'd10', name: 'Autorizado 10%', percent: 10, active: true, admin_only: true },
          { id: 'd15', name: 'Autorizado 15%', percent: 15, active: true, admin_only: true }
        ],
        orders: orders, payouts: [], featured: null, audit: []
      };
    },
    audit: function (data, action, entity, after) {
      data.audit.unshift({
        id: data.audit.length + 1, actor_id: state.me.id, actor_name: state.me.name,
        action: action, entity: entity, after_data: after || null, created_at: new Date().toISOString()
      });
    }
  };

  /* =================== capa de datos ======================== */
  var db = {
    isDemo: function () { return state.mode === 'demo'; },

    loadAll: function () {
      return state.mode === 'demo' ? db.loadDemo() : db.loadSupabase();
    },

    loadDemo: function () {
      var data = demo.load();
      var isAdmin = state.me.role === 'admin';
      state.services = data.services.slice();
      state.discounts = data.discounts.slice();
      state.orders = data.orders.filter(function (o) { return isAdmin || o.employee_id === state.me.id; });
      state.profiles = isAdmin ? data.profiles.slice() : [state.me];
      state.payouts = data.payouts.filter(function (p) { return isAdmin || p.employee_id === state.me.id; });
      state.audit = isAdmin ? data.audit.slice(0, 50) : [];
      state.featured = db.computeFeatured(data.orders, data.profiles, data.featured);
      return Promise.resolve();
    },

    /* Réplica local de os_month_feature para el modo demo. */
    computeFeatured: function (orders, profiles, chosen) {
      var start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
      var mine = orders.filter(function (o) { return o.status === 'active' && new Date(o.created_at) >= start; });
      var totals = {};
      mine.forEach(function (o) {
        totals[o.employee_id] = totals[o.employee_id] || { total: 0, count: 0, earning: 0 };
        totals[o.employee_id].total += o.total;
        totals[o.employee_id].count += 1;
        totals[o.employee_id].earning += o.earning;
      });
      var bestId = chosen && chosen.employee_id;
      if (!bestId) {
        bestId = Object.keys(totals).sort(function (a, b) { return totals[b].total - totals[a].total; })[0];
      }
      if (!bestId) return null;
      var person = profiles.filter(function (p) { return p.id === bestId; })[0];
      if (!person) return null;
      var agg = totals[bestId] || { total: 0, count: 0, earning: 0 };
      return {
        employee_id: bestId, name: person.name,
        photo_url: (chosen && chosen.photo_url) || '',
        note: (chosen && chosen.note) || 'Mayor facturación del mes',
        count: agg.count, total: agg.total, earning: agg.earning
      };
    },

    loadSupabase: function () {
      var sb = state.client, isAdmin = state.me.role === 'admin';
      var month = new Date(); month.setDate(1);
      var jobs = [
        sb.from('os_services').select('*').order('sort'),
        sb.from('os_discounts').select('*').order('name'),
        sb.from('os_orders').select('*').order('created_at', { ascending: false }).limit(600),
        sb.from('os_profiles').select('*').order('name'),
        sb.from('os_payouts').select('*').order('created_at', { ascending: false }).limit(200),
        sb.rpc('os_month_feature', { p_month: dateOnly(month) })
      ];
      if (isAdmin) jobs.push(sb.from('os_audit').select('*').order('created_at', { ascending: false }).limit(50));

      return Promise.all(jobs).then(function (res) {
        if (res[0].error) throw res[0].error;
        state.services = res[0].data || [];
        state.discounts = res[1].data || [];
        state.orders = res[2].data || [];
        state.profiles = res[3].data || [];
        state.payouts = res[4].data || [];
        state.featured = res[5] && res[5].data ? res[5].data : null;
        state.audit = res[6] && res[6].data ? res[6].data : [];
      });
    },

    submitOrder: function (payload) {
      if (state.mode !== 'demo') {
        return state.client.rpc('os_submit_order', { p_order: payload }).then(function (r) {
          if (r.error) throw r.error; return r.data;
        });
      }
      var data = demo.load();
      var existing = data.orders.filter(function (o) {
        return o.employee_id === state.me.id && o.request_id === payload.request_id;
      })[0];
      if (existing) return Promise.resolve(existing.id);

      var cart = {};
      payload.lines.forEach(function (l) { cart[l.service_id] = l.qty; });
      var d = data.discounts.filter(function (x) { return x.id === payload.discount_id; })[0];
      if (payload.discount_id && !d) return Promise.reject(Error('Convenio no autorizado'));
      if (d && d.admin_only && state.me.role !== 'admin') return Promise.reject(Error('Convenio no autorizado'));
      var calc;
      try { calc = OS.calculate(data.services, cart, d ? d.percent : 0, state.me.commission); }
      catch (e) { return Promise.reject(e); }

      var order = {
        id: uuid(), number: 1000 + data.orders.length + 1, request_id: payload.request_id,
        employee_id: state.me.id, employee_name: state.me.name,
        client: payload.client, plate: String(payload.plate).toUpperCase(), model: payload.model,
        payment: payload.payment, note: payload.note || '',
        items: calc.lines.map(function (l) {
          return { id: l.id, name: l.name, category: l.category, qty: l.qty, price: l.price, cost: l.cost, line_total: l.line_total, line_cost: l.line_cost, cost_confirmed: l.cost_confirmed !== false };
        }),
        subtotal: calc.subtotal, cost: calc.cost, cost_confirmed: calc.costConfirmed,
        discount: calc.discount, discount_name: d ? d.name : 'Sin convenio', total: calc.total,
        commission_percent: state.me.commission, earning: calc.earning, net: calc.net,
        status: 'active', void_reason: null, payout_id: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      data.orders.unshift(order);
      demo.audit(data, 'order.created', order.id, { total: order.total, client: order.client });
      demo.save(data);
      return Promise.resolve(order.id);
    },

    editOrder: function (id, changes) {
      if (state.mode !== 'demo') {
        return state.client.rpc('os_edit_order', { p_id: id, p_changes: changes })
          .then(function (r) { if (r.error) throw r.error; });
      }
      if (state.me.role !== 'admin') return Promise.reject(Error('Solo administradores'));
      var data = demo.load();
      var order = data.orders.filter(function (o) { return o.id === id; })[0];
      if (!order) return Promise.reject(Error('Orden no encontrada'));
      if (!/^[A-Z0-9 -]{1,16}$/i.test(String(changes.plate || '').trim())) return Promise.reject(Error('Matrícula inválida'));
      order.client = String(changes.client).trim();
      order.plate = String(changes.plate).trim().toUpperCase();
      order.model = String(changes.model).trim();
      order.note = String(changes.note || '').trim();
      order.updated_at = new Date().toISOString();
      demo.audit(data, 'order.edited', id, changes);
      demo.save(data);
      return Promise.resolve();
    },

    voidOrder: function (id, reason) {
      if (state.mode !== 'demo') {
        return state.client.rpc('os_void_order', { p_id: id, p_reason: reason })
          .then(function (r) { if (r.error) throw r.error; });
      }
      if (state.me.role !== 'admin') return Promise.reject(Error('Solo administradores'));
      var text = String(reason || '').trim();
      if (text.length < 3 || text.length > 300) return Promise.reject(Error('Indica el motivo (3–300 caracteres)'));
      var data = demo.load();
      var order = data.orders.filter(function (o) { return o.id === id; })[0];
      if (!order) return Promise.reject(Error('Orden no encontrada'));
      if (order.payout_id) return Promise.reject(Error('La orden ya pertenece a un corte pagado'));
      order.status = 'void'; order.void_reason = text; order.updated_at = new Date().toISOString();
      demo.audit(data, 'order.voided', id, { reason: text });
      demo.save(data);
      return Promise.resolve();
    },

    deleteOrder: function (id, reason) {
      if (state.mode !== 'demo') {
        return state.client.rpc('os_delete_order', { p_id: id, p_reason: reason })
          .then(function (r) { if (r.error) throw r.error; });
      }
      if (state.me.role !== 'admin') return Promise.reject(Error('Solo administradores'));
      var text = String(reason || '').trim();
      if (text.length < 3 || text.length > 300) return Promise.reject(Error('Indica el motivo del borrado (3–300 caracteres)'));
      var data = demo.load();
      var index = -1;
      data.orders.forEach(function (o, i) { if (o.id === id) index = i; });
      if (index < 0) return Promise.reject(Error('Orden no encontrada'));
      var order = data.orders[index];
      if (order.status !== 'void') return Promise.reject(Error('Solo se pueden borrar órdenes anuladas; anúlala primero'));
      if (order.payout_id) return Promise.reject(Error('La orden pertenece a un corte pagado'));
      demo.audit(data, 'order.deleted', id, { reason: text, total: order.total });
      data.orders.splice(index, 1);
      demo.save(data);
      return Promise.resolve();
    },

    payEmployee: function (employeeId) {
      if (state.mode !== 'demo') {
        return state.client.rpc('os_pay_employee', { p_employee: employeeId })
          .then(function (r) { if (r.error) throw r.error; return r.data; });
      }
      if (state.me.role !== 'admin') return Promise.reject(Error('Solo administradores'));
      var data = demo.load();
      var pending = data.orders.filter(function (o) {
        return o.employee_id === employeeId && o.status === 'active' && !o.payout_id;
      });
      var amount = OS.round(pending.reduce(function (s, o) { return s + o.earning; }, 0));
      if (!pending.length || amount <= 0) return Promise.reject(Error('No hay comisiones pendientes de pago'));
      var person = data.profiles.filter(function (p) { return p.id === employeeId; })[0];
      var payout = {
        id: uuid(), employee_id: employeeId, employee_name: person ? person.name : '—',
        amount: amount, order_ids: pending.map(function (o) { return o.id; }),
        created_by: state.me.id, created_at: new Date().toISOString()
      };
      pending.forEach(function (o) { o.payout_id = payout.id; });
      data.payouts.unshift(payout);
      demo.audit(data, 'payout.created', payout.id, { amount: amount });
      demo.save(data);
      return Promise.resolve(payout.id);
    },

    /* Crea la cuenta de autenticación del nuevo empleado.
       Se usa un cliente aparte con persistSession desactivado: signUp
       devuelve la sesión del usuario recién creado y, sin esto, el
       administrador quedaría desconectado de su propia sesión. */
    createAccount: function (email, password) {
      if (state.mode === 'demo') return Promise.resolve();
      var cfg = readConfig();
      var temp = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      return temp.auth.signUp({ email: email, password: password }).then(function (res) {
        if (res.error) {
          var message = String(res.error.message || '');
          // Si la cuenta ya existía, seguimos: solo le falta el perfil.
          if (/already|registrad/i.test(message)) return false;
          throw res.error;
        }
        // Sin sesión de vuelta, el proyecto exige confirmar el correo y
        // el empleado no podrá entrar hasta que se desactive esa opción.
        return !!(res.data && res.data.user && !res.data.session);
      });
    },

    deleteProfile: function (id) {
      if (state.mode !== 'demo') {
        return state.client.rpc('os_delete_profile', { p_id: id })
          .then(function (r) { if (r.error) throw r.error; });
      }
      if (state.me.role !== 'admin') return Promise.reject(Error('Solo administradores'));
      var data = demo.load();
      var index = -1;
      data.profiles.forEach(function (p, i) { if (p.id === id) index = i; });
      if (index < 0) return Promise.reject(Error('Empleado no encontrado'));
      var person = data.profiles[index];
      if (person.id === state.me.id) return Promise.reject(Error('No puedes eliminar tu propia cuenta'));
      if (person.role === 'admin' && person.active &&
          !data.profiles.some(function (p) { return p.id !== id && p.role === 'admin' && p.active; })) {
        return Promise.reject(Error('Debe quedar un administrador activo'));
      }
      if (data.orders.some(function (o) { return o.employee_id === id && o.status === 'active'; })) {
        return Promise.reject(Error('Tiene \u00f3rdenes activas; an\u00falalas antes de eliminarlo'));
      }
      if (data.orders.some(function (o) { return o.employee_id === id; })) {
        return Promise.reject(Error('Tiene \u00f3rdenes en el historial; desactiva la cuenta en lugar de eliminarla'));
      }
      if (data.payouts.some(function (p) { return p.employee_id === id || p.created_by === id; })) {
        return Promise.reject(Error('Tiene cortes de pago registrados; desactiva la cuenta en lugar de eliminarla'));
      }
      demo.audit(data, 'profile.deleted', id, { name: person.name });
      data.profiles.splice(index, 1);
      demo.save(data);
      return Promise.resolve();
    },

    manage: function (kind, payload) {
      if (state.mode !== 'demo') {
        return state.client.rpc('os_manage', { p_kind: kind, p_data: payload })
          .then(function (r) { if (r.error) throw r.error; });
      }
      if (state.me.role !== 'admin') return Promise.reject(Error('Solo administradores'));
      var data = demo.load();
      if (kind === 'profile_create') {
        if (data.profiles.some(function (p) { return (p.email || '').toLowerCase() === String(payload.email).toLowerCase(); })) {
          return Promise.reject(Error('Ese empleado ya está dado de alta'));
        }
        data.profiles.push({
          id: uuid(), name: String(payload.name).trim(), email: String(payload.email).trim().toLowerCase(),
          role: payload.role, commission: Number(payload.commission), active: true
        });
      } else if (kind === 'profile') {
        var person = data.profiles.filter(function (p) { return p.id === payload.id; })[0];
        if (!person) return Promise.reject(Error('Empleado no encontrado'));
        if (person.id === state.me.id && (payload.role !== 'admin' || !payload.active)) {
          return Promise.reject(Error('No puedes desactivar tu propia cuenta ni quitarte el rol'));
        }
        var otherAdmin = data.profiles.some(function (p) { return p.id !== person.id && p.role === 'admin' && p.active; });
        if (person.role === 'admin' && person.active && (payload.role !== 'admin' || !payload.active) && !otherAdmin) {
          return Promise.reject(Error('Debe quedar un administrador activo'));
        }
        person.name = String(payload.name).trim();
        person.role = payload.role;
        person.commission = Number(payload.commission);
        person.active = !!payload.active;
      } else if (kind === 'service') {
        if (CATEGORIES.indexOf(payload.category) < 0) return Promise.reject(Error('Categoría inválida'));
        var svc = data.services.filter(function (s) { return s.id === payload.id; })[0];
        if (!svc) { svc = { id: payload.id || uuid(), sort: 100 }; data.services.push(svc); }
        svc.name = String(payload.name).trim();
        svc.category = payload.category;
        svc.cost = Number(payload.cost);
        svc.price = Number(payload.price);
        svc.description = String(payload.description || '').slice(0, 500);
        svc.cost_confirmed = payload.cost_confirmed !== false;
        svc.active = payload.active !== false;
      } else if (kind === 'discount') {
        var disc = data.discounts.filter(function (x) { return x.id === payload.id; })[0];
        if (!disc) { disc = { id: payload.id || uuid() }; data.discounts.push(disc); }
        disc.name = String(payload.name).trim();
        disc.percent = Number(payload.percent);
        disc.active = !!payload.active;
        disc.admin_only = !!payload.admin_only;
        disc.logo_url = payload.logo_url || '';
      } else if (kind === 'featured') {
        data.featured = { employee_id: payload.employee_id, photo_url: payload.photo_url || '', note: payload.note || '' };
      } else {
        return Promise.reject(Error('Acción desconocida'));
      }
      demo.audit(data, kind + '.saved', payload.id || 'new', payload);
      demo.save(data);
      return Promise.resolve();
    }
  };

  /* ==================== logotipos ==========================
     En Supabase van al bucket overspeed-photos (público, escritura
     solo para administradores). En demo se guardan como data URL
     dentro del propio localStorage.                              */
  var LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var LOGO_MAX = 2 * 1024 * 1024;

  function checkLogo(file) {
    if (LOGO_TYPES.indexOf(file.type) < 0) throw Error('El logo debe ser PNG, JPG o WebP');
    if (file.size > LOGO_MAX) throw Error('El logo no puede pasar de 2 MB');
  }
  function readDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(Error('No se pudo leer el archivo')); };
      reader.readAsDataURL(file);
    });
  }
  function uploadLogo(file, id) {
    try { checkLogo(file); } catch (e) { return Promise.reject(e); }
    if (state.mode === 'demo') return readDataUrl(file);
    var ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[file.type];
    var path = 'convenios/' + (id || uuid()) + '-' + Date.now() + '.' + ext;
    var bucket = state.client.storage.from('overspeed-photos');
    return bucket.upload(path, file, { contentType: file.type, upsert: true }).then(function (res) {
      if (res.error) throw res.error;
      return bucket.getPublicUrl(path).data.publicUrl;
    });
  }
  function logoTile(discount, size) {
    var px = size || 44;
    return discount.logo_url
      ? '<img class="brand-logo" style="width:' + px + 'px;height:' + px + 'px" src="' + esc(discount.logo_url) + '" alt="' + esc(discount.name) + '" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'brand-logo brand-logo--empty\',textContent:\'' + esc(initials(discount.name)) + '\'}))">'
      : '<span class="brand-logo brand-logo--empty" style="width:' + px + 'px;height:' + px + 'px">' + esc(initials(discount.name)) + '</span>';
  }
  /* ====================== modal / diálogo =================== */
  function openModal(title, bodyHtml, onReady) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    if (onReady) onReady($('modalBody'));
    var dialog = $('modal');
    if (!dialog.open) dialog.showModal();
  }
  function closeModal() { var d = $('modal'); if (d.open) d.close(); }

  /* ====================== acceso / sesión =================== */
  function showGate(message, isError) {
    $('gate').hidden = false;
    $('application').hidden = true;
    var status = $('gateStatus');
    status.textContent = message || '';
    status.classList.toggle('error', !!isError);
  }

  function enter() {
    $('gate').hidden = true;
    $('application').hidden = false;
    $('demoBanner').hidden = state.mode !== 'demo';
    $('accountBtn').textContent = initials(state.me.name);
    $('connectionStatus').textContent = state.mode === 'demo' ? 'Demo local' : 'Conectado';
    $('connectionStatus').classList.toggle('error', state.mode === 'demo');
    applyRole();
    refreshAll().then(function () { setView(state.view); });
  }

  function applyRole() {
    var isAdmin = state.me.role === 'admin';
    Array.prototype.forEach.call(document.querySelectorAll('.admin-only'), function (el) {
      el.hidden = !isAdmin;
    });
  }

  function refreshAll() {
    return db.loadAll().then(function () {
      renderCurrent();
    }).catch(function (e) { fail(e); });
  }

  function loadProfile() {
    return state.client.auth.getUser().then(function (res) {
      var user = res.data && res.data.user;
      if (!user) throw Error('Sesión no válida');
      return state.client.from('os_profiles').select('*').eq('id', user.id).maybeSingle();
    }).then(function (res) {
      if (res.error) throw res.error;
      if (!res.data) throw Error('Tu usuario no tiene perfil en OverSpeed. Pide al administrador que lo active.');
      if (!res.data.active) throw Error('Tu cuenta está desactivada.');
      state.me = res.data;
      return state.me;
    });
  }

  /* Supabase responde en ingles y hablando de correos. Aqui solo existen
     usuarios, asi que los mensajes habituales se reescriben. */
  function traducir(message) {
    if (/invalid login credentials/i.test(message)) return 'Usuario o contrase\u00f1a incorrectos.';
    if (/email not confirmed/i.test(message)) return 'La cuenta est\u00e1 pendiente de verificaci\u00f3n. Av\u00edsale a un administrador.';
    if (/user already registered/i.test(message)) return 'Ese usuario ya existe.';
    if (/validate email|email address|invalid.*email/i.test(message)) return 'El usuario no tiene un formato v\u00e1lido.';
    if (/password/i.test(message) && /short|least/i.test(message)) return 'La contrase\u00f1a es demasiado corta.';
    if (/rate limit|too many/i.test(message)) return 'Demasiados intentos seguidos. Espera un momento.';
    if (/signups? (not allowed|disabled)/i.test(message)) return 'El alta de cuentas est\u00e1 desactivada en Supabase.';
    return message;
  }

  function doLogin(event) {
    event.preventDefault();
    if (!state.client) state.client = makeClient();
    if (!state.client) {
      showGate('Falta configurar la conexión de Supabase. Ábrela más abajo o usa la demo local.', true);
      return;
    }
    showGate('Comprobando credenciales…');
    state.mode = 'supabase';
    state.client.auth.signInWithPassword({
      email: toEmail($('loginEmail').value),
      password: $('loginPassword').value
    }).then(function (res) {
      if (res.error) throw res.error;
      return loadProfile();
    }).then(function () {
      $('loginPassword').value = '';
      enter();
    }).catch(function (e) {
      var message = traducir(String((e && e.message) || ''));
      if (/confirm/i.test(message)) {
        message = 'La cuenta existe pero est\u00e1 pendiente de verificaci\u00f3n. ' +
          'Un administrador debe desactivar \u00abConfirm email\u00bb en Supabase.';
      }
      showGate(message || 'No se pudo iniciar sesión.', true);
    });
  }

  function startDemo() {
    state.mode = 'demo';
    var data = demo.load();
    state.me = data.profiles.filter(function (p) { return p.role === state.demoRole; })[0] || data.profiles[0];
    enter();
    toast('Demo local activa · datos de ejemplo en este navegador');
  }

  function logout() {
    var done = state.mode === 'supabase' && state.client
      ? state.client.auth.signOut()
      : Promise.resolve();
    done.then(function () {
      state.me = null; state.mode = null; state.cart = {}; state.discountId = '';
      showGate('Sesión cerrada.');
    });
  }

  /* ========================= router ========================= */
  var RENDERERS = {
    dashboard: renderDashboard,
    workshop: renderWorkshop,
    history: renderHistory,
    customers: renderCustomers,
    team: renderTeam,
    stats: renderStats,
    payouts: renderPayouts,
    catalog: renderCatalog,
    settings: renderSettings
  };

  function setView(name) {
    if (!RENDERERS[name]) return;
    state.view = name;
    Array.prototype.forEach.call(document.querySelectorAll('main .view'), function (section) {
      section.hidden = section.id !== 'view-' + name;
    });
    Array.prototype.forEach.call(document.querySelectorAll('nav [data-view]'), function (button) {
      button.classList.toggle('active', button.dataset.view === name);
    });
    renderCurrent();
  }
  function renderCurrent() {
    if (!state.me) return;
    var render = RENDERERS[state.view];
    if (render) render();
  }

  /* ======================== DASHBOARD ======================= */
  function monthStart() { var d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; }

  function renderDashboard() {
    var start = monthStart();
    var active = state.orders.filter(function (o) { return o.status === 'active'; });
    var thisMonth = active.filter(function (o) { return new Date(o.created_at) >= start; });
    var vehicles = {}, clients = {};
    thisMonth.forEach(function (o) { vehicles[o.plate] = 1; clients[o.client] = 1; });
    var income = OS.round(thisMonth.reduce(function (s, o) { return s + o.total; }, 0));

    $('today').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

    $('dashboardMetrics').innerHTML = [
      metricCard('Órdenes activas', thisMonth.length, 'accent'),
      metricCard('Vehículos atendidos', Object.keys(vehicles).length),
      metricCard('Clientes este mes', Object.keys(clients).length),
      metricCard('Ingresos del mes', money(income))
    ].join('');

    // Ingresos de los últimos 30 días
    var series = [], labels = [];
    for (var i = 29; i >= 0; i--) {
      var day = daysAgo(i), key = dateOnly(day);
      var sum = active.reduce(function (s, o) { return dateOnly(o.created_at) === key ? s + o.total : s; }, 0);
      series.push(OS.round(sum));
      labels.push(i % 7 === 0 ? day.getDate() + '/' + (day.getMonth() + 1) : '');
    }
    $('dashboardChart').innerHTML = lineChart(series, labels);
    var half = Math.floor(series.length / 2);
    var older = series.slice(0, half).reduce(function (a, b) { return a + b; }, 0);
    var recent = series.slice(half).reduce(function (a, b) { return a + b; }, 0);
    var trend = older ? Math.round((recent - older) / older * 100) : 0;
    var trendEl = $('dashboardTrend');
    trendEl.textContent = (trend >= 0 ? '+' : '') + trend + '%';
    trendEl.style.color = trend >= 0 ? 'var(--green)' : 'var(--red-bright)';

    // Órdenes por estado (el esquema define active/void; el resto sale de payout_id)
    var paid = active.filter(function (o) { return o.payout_id; }).length;
    var pending = active.length - paid;
    var voided = state.orders.length - active.length;
    $('dashboardStatus').innerHTML = donut([
      { label: 'Pendientes de corte', value: pending, color: 'var(--red)' },
      { label: 'Comisión pagada', value: paid, color: 'var(--green)' },
      { label: 'Anuladas', value: voided, color: 'var(--violet)' }
    ]);

    // Empleado del mes
    var f = state.featured;
    $('dashboardFeatured').innerHTML = f ? (
      '<div class="featured-person">' +
      (f.photo_url ? '<img class="photo-avatar" src="' + esc(f.photo_url) + '" alt="">' : '<span class="photo-avatar">' + esc(initials(f.name)) + '</span>') +
      '<div><h3>' + esc(f.name) + '</h3><p>' + esc(f.note || '') + '</p>' +
      '<div class="feature-stats"><span><b>' + f.count + '</b>órdenes</span><span><b>' + money(f.total) + '</b>facturado</span></div>' +
      '</div></div>'
    ) : '<p class="empty">Sin actividad registrada este mes.</p>';

    // Servicio más común
    var byService = {};
    thisMonth.forEach(function (o) {
      (o.items || []).forEach(function (it) {
        byService[it.name] = (byService[it.name] || 0) + it.qty;
      });
    });
    var topService = Object.keys(byService).sort(function (a, b) { return byService[b] - byService[a]; })[0];
    $('dashboardTopService').innerHTML = topService
      ? '<h3>' + esc(topService) + '</h3><p class="muted">' + byService[topService] + ' unidades este mes</p>'
      : '<p class="empty">Sin servicios registrados.</p>';

    // Cliente destacado
    var byClient = {};
    thisMonth.forEach(function (o) { byClient[o.client] = (byClient[o.client] || 0) + o.total; });
    var topClient = Object.keys(byClient).sort(function (a, b) { return byClient[b] - byClient[a]; })[0];
    $('dashboardTopClient').innerHTML = topClient
      ? '<h3>' + esc(topClient) + '</h3><p class="muted">' + money(byClient[topClient]) + ' facturado</p>'
      : '<p class="empty">Sin clientes registrados.</p>';
  }

  function metricCard(label, value, extra) {
    return '<article class="metric ' + (extra || '') + '"><strong>' + esc(value) + '</strong><small>' + esc(label) + '</small></article>';
  }

  function lineChart(values, labels) {
    var w = 640, h = 200, pad = 34;
    var max = Math.max.apply(null, values.concat([1]));
    var step = (w - pad * 2) / Math.max(values.length - 1, 1);
    var points = values.map(function (v, i) {
      var x = pad + i * step, y = h - pad - (v / max) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var y = pad + g * (h - pad * 2) / 4;
      grid += '<line x1="' + pad + '" y1="' + y + '" x2="' + (w - pad) + '" y2="' + y + '"/>' +
        '<text x="4" y="' + (y + 3) + '">' + Math.round(max - g * max / 4) + '</text>';
    }
    var area = 'M' + pad + ',' + (h - pad) + ' L' + points.join(' L') + ' L' + (w - pad) + ',' + (h - pad) + ' Z';
    var ticks = labels.map(function (t, i) {
      return t ? '<text x="' + (pad + i * step) + '" y="' + (h - 10) + '" text-anchor="middle">' + esc(t) + '</text>' : '';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="osFade" x1="0" x2="0" y1="0" y2="1">' +
      '<stop offset="0%" stop-color="#F5333F" stop-opacity=".34"/><stop offset="100%" stop-color="#F5333F" stop-opacity="0"/>' +
      '</linearGradient></defs>' + grid +
      '<path d="' + area + '" fill="url(#osFade)" stroke="none"/>' +
      '<polyline points="' + points.join(' ') + '"/>' + ticks + '</svg>';
  }

  function donut(slices) {
    var total = slices.reduce(function (s, x) { return s + x.value; }, 0);
    var r = 54, c = 2 * Math.PI * r, offset = 0;
    var arcs = slices.map(function (s) {
      var len = total ? (s.value / total) * c : 0;
      var el = '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' + s.color + '" stroke-width="22"' +
        ' stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) + '"' +
        ' stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 70 70)"/>';
      offset += len;
      return el;
    }).join('');
    var legend = slices.map(function (s) {
      return '<div class="rank-row"><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
        s.color + ';margin-right:9px"></i>' + esc(s.label) + '</span><b>' + s.value + '</b></div>';
    }).join('');
    return '<div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap">' +
      '<svg viewBox="0 0 140 140" style="width:140px;height:140px;flex-shrink:0">' + arcs +
      '<text x="70" y="68" text-anchor="middle" fill="#F2F3F5" font-size="24" font-weight="700">' + total + '</text>' +
      '<text x="70" y="86" text-anchor="middle" fill="#6B7077" font-size="11">Total</text></svg>' +
      '<div style="flex:1;min-width:180px">' + legend + '</div></div>';
  }

  /* ================== TPV / NUEVA VENTA ===================== */
  function activeServices() {
    return state.services.filter(function (s) { return s.active !== false; });
  }
  /* Convenios que este usuario puede aplicar ahora mismo. */
  function usableDiscounts() {
    var isAdmin = state.me.role === 'admin';
    return state.discounts.filter(function (d) {
      return d.active && (!d.admin_only || isAdmin);
    });
  }

  function currentDiscount() {
    var d = state.discounts.filter(function (x) { return x.id === state.discountId; })[0];
    return d ? d.percent : 0;
  }
  function currentCalc() {
    try { return OS.calculate(activeServices(), state.cart, currentDiscount(), state.me.commission); }
    catch (e) { return null; }
  }

  function renderWorkshop() {
    var services = activeServices();
    var search = ($('serviceSearch').value || '').toLowerCase();
    var category = state.category || '';

    // Categorías
    var cats = [];
    services.forEach(function (s) { if (cats.indexOf(s.category) < 0) cats.push(s.category); });
    $('categories').innerHTML = ['<button data-cat="" class="' + (category ? '' : 'active') + '">Todos</button>']
      .concat(cats.map(function (c) {
        return '<button data-cat="' + esc(c) + '" class="' + (category === c ? 'active' : '') + '">' + esc(c) + '</button>';
      })).join('');

    // Filas de servicio, agrupadas por categoría
    var visible = services.filter(function (s) {
      if (category && s.category !== category) return false;
      if (!search) return true;
      return (s.name + ' ' + s.category + ' ' + (s.description || '')).toLowerCase().indexOf(search) >= 0;
    });
    var groups = {}, order = [];
    visible.forEach(function (s) {
      if (!groups[s.category]) { groups[s.category] = []; order.push(s.category); }
      groups[s.category].push(s);
    });
    $('serviceRows').innerHTML = visible.length ? order.map(function (cat) {
      return '<tr class="group-row"><td colspan="5">' + esc(cat) + '</td></tr>' +
        groups[cat].map(function (s) {
          var qty = state.cart[s.id] || 0;
          return '<tr data-service="' + esc(s.id) + '" class="' + (qty ? 'selected' : '') + '">' +
            '<td><div class="service-name"><div><strong>' + esc(s.name) + '</strong>' +
            (s.description ? '<small>' + esc(s.description) + '</small>' : '') + '</div></div></td>' +
            '<td><div class="unit-cell">' +
            '<span class="unit-field">' +
            '<input class="unit-input" type="number" min="1" max="9999" step="1" value="' + (qty || 1) + '" data-action="qty" aria-label="Unidades de ' + esc(s.name) + '">' +
            '<span class="unit-steps">' +
            '<button type="button" data-action="up" tabindex="-1" aria-label="Subir">' + CARET_UP + '</button>' +
            '<button type="button" data-action="down" tabindex="-1" aria-label="Bajar">' + CARET_DOWN + '</button>' +
            '</span></span>' +
            '<button type="button" class="unit-add" data-action="add" aria-label="Añadir a la orden">' + PLUS + '</button>' +
            '<button type="button" class="unit-remove' + (qty ? '' : ' is-idle') + '" data-action="remove" aria-label="Quitar de la orden"' + (qty ? '' : ' tabindex="-1"') + '>' + CROSS + '</button>' +
            '</div></td>' +
            '<td class="cost-cell">' + money(s.cost) +
            (s.cost_confirmed === false ? ' <span class="tag neutral">?</span>' : '') + '</td>' +
            '<td class="price-cell">' + money(s.price) + '</td>' +
            '<td class="amount"><span class="line-count' + (qty ? '' : ' is-idle') + '">×' + qty + '</span>' +
            '<span class="line-total">' + money(OS.round(s.price * qty)) + '</span></td>' +
            '</tr>';
        }).join('');
    }).join('') : '<tr><td colspan="5"><p class="empty">Ninguna pieza coincide con la búsqueda.</p></td></tr>';

    // Convenios
    var select = $('discountSelect');
    select.innerHTML = '<option value="">Sin convenio</option>' + usableDiscounts().map(function (d) {
      return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>';
    }).join('');
    select.value = state.discountId;
    paintDiscountLogo();

    updateQuote();

    // Sugerencias de cliente y matrícula
    var clients = {}, plates = {};
    state.orders.forEach(function (o) { clients[o.client] = 1; plates[o.plate] = 1; });
    $('knownClients').innerHTML = Object.keys(clients).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
    $('knownPlates').innerHTML = Object.keys(plates).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');

    renderPulse();
  }

  function renderPulse() {
    var start = monthStart();
    var mine = state.orders.filter(function (o) {
      return o.status === 'active' && new Date(o.created_at) >= start;
    });
    var total = OS.round(mine.reduce(function (s, o) { return s + o.total; }, 0));
    var earning = OS.round(mine.reduce(function (s, o) { return s + o.earning; }, 0));
    $('pulseContent').innerHTML =
      '<div class="pulse-metrics">' +
      '<div><strong>' + mine.length + '</strong><small>órdenes del mes</small></div>' +
      '<div><strong>' + money(total) + '</strong><small>facturado</small></div>' +
      '<div><strong>' + money(earning) + '</strong><small>comisión</small></div>' +
      '</div>';

    var f = state.featured;
    $('featuredContent').innerHTML = f ? (
      '<div class="featured-person">' +
      (f.photo_url ? '<img class="photo-avatar" src="' + esc(f.photo_url) + '" alt="">' : '<span class="photo-avatar">' + esc(initials(f.name)) + '</span>') +
      '<div><h3>' + esc(f.name) + '</h3><p>' + esc(f.note || '') + '</p>' +
      '<div class="feature-stats"><span><b>' + f.count + '</b>órdenes</span><span><b>' + money(f.total) + '</b>facturado</span></div>' +
      '</div></div>'
    ) : '<p class="empty">Aún no hay empleado destacado este mes.</p>';
  }

  /* Lista de lo que lleva la orden, con borrado por línea. */
  function renderOrderPanel() {
    var services = activeServices();
    var ids = Object.keys(state.cart).filter(function (id) {
      return services.some(function (s) { return s.id === id; });
    });
    $('orderItems').innerHTML = ids.length ? ids.map(function (id) {
      var service = services.filter(function (s) { return s.id === id; })[0];
      var qty = state.cart[id];
      return '<div class="ticket-line">' +
        '<div class="ticket-line__info"><strong>' + esc(service.name) + '</strong>' +
        '<small>' + qty + ' × ' + money(service.price) + '</small></div>' +
        '<span class="ticket-line__amount">' + money(OS.round(service.price * qty)) + '</span>' +
        '<button type="button" class="ticket-line__remove" data-remove-line="' + esc(id) +
        '" aria-label="Quitar ' + esc(service.name) + ' de la orden">' + CROSS + '</button>' +
        '</div>';
    }).join('') : '<p class="empty">La orden está vacía.<br>Añade piezas con el botón rojo.</p>';
    $('clearOrder').hidden = !ids.length;
  }

  /* Logotipo del convenio aplicado, junto al selector del TPV. */
  function paintDiscountLogo() {
    var slot = $('discountLogo');
    if (!slot) return;
    var d = state.discounts.filter(function (x) { return x.id === state.discountId; })[0];
    slot.innerHTML = d ? logoTile(d, 28) : '';
    slot.hidden = !d;
  }

  /* Cliente, matrícula y vehículo son obligatorios: sin los tres no se
     puede abrir la revisión. Devuelve la lista de lo que falta.        */
  function missingVehicleFields() {
    var missing = [];
    var client = ($('client').value || '').trim();
    var plate = ($('plate').value || '').trim();
    if (!client || client.length > 120) missing.push({ id: 'client', label: 'cliente' });
    if (!/^[A-Z0-9 -]{1,16}$/i.test(plate)) missing.push({ id: 'plate', label: 'matrícula' });
    return missing;
  }

  /* Marca en rojo solo los campos que el usuario ya tocó. */
  function paintVehicleFields(forceAll) {
    var missing = missingVehicleFields().map(function (m) { return m.id; });
    ['client', 'plate'].forEach(function (id) {
      var field = $(id);
      var bad = missing.indexOf(id) >= 0 && (forceAll || field.dataset.touched === '1');
      field.setAttribute('aria-invalid', bad ? 'true' : 'false');
    });
  }

  /* Totales de la barra inferior. Se recalcula sin redibujar la tabla,
     para no perder el foco mientras se teclean unidades. */
  function updateQuote() {
    var calc = currentCalc();
    var count = Object.keys(state.cart).length;
    $('selectedCount').textContent = count + (count === 1 ? ' pieza seleccionada' : ' piezas seleccionadas');
    $('quoteTotal').textContent = money(calc ? calc.total : 0);
    var missing = missingVehicleFields();
    $('reviewBtn').disabled = !count || missing.length > 0;
    if (!count) {
      $('selectedInfo').textContent = 'Elige las piezas y servicios de esta orden.';
    } else if (missing.length) {
      $('selectedInfo').innerHTML = '<span class="danger">Falta ' +
        missing.map(function (m) { return m.label; }).join(', ') + '</span>' +
        ' · subtotal ' + money(calc.subtotal);
    } else {
      $('selectedInfo').textContent = 'Subtotal ' + money(calc.subtotal) + ' · coste ' + money(calc.cost) +
        (calc.discount ? ' · convenio −' + money(calc.discount) : '');
    }
    paintVehicleFields();
    renderOrderPanel();
    $('draftLabel').textContent = count ? 'EN CURSO' : 'NUEVA';
  }

  /* Actualiza una sola fila sin redibujar la tabla, para no perder
     el foco ni la posición del scroll mientras se ajustan unidades. */
  function touchRow(row, id) {
    var service = activeServices().filter(function (s) { return s.id === id; })[0];
    if (!service) return;
    var qty = state.cart[id] || 0;
    row.classList.toggle('selected', !!qty);

    var total = row.querySelector('.line-total');
    if (total) total.textContent = money(OS.round(service.price * qty));

    var counter = row.querySelector('.line-count');
    if (counter) {
      counter.textContent = '×' + qty;
      counter.classList.toggle('is-idle', !qty);
    }

    var remove = row.querySelector('.unit-remove');
    if (remove) {
      remove.classList.toggle('is-idle', !qty);
      if (qty) remove.removeAttribute('tabindex'); else remove.setAttribute('tabindex', '-1');
    }

    updateQuote();
  }

  function openReview() {
    var calc = currentCalc();
    if (!calc) return fail(Error('Revisa las cantidades de la orden'));
    var missing = missingVehicleFields();
    if (missing.length) {
      ['client', 'plate'].forEach(function (id) { $(id).dataset.touched = '1'; });
      paintVehicleFields(true);
      $(missing[0].id).focus();
      return fail(Error('Completa ' + missing.map(function (m) { return m.label; }).join(', ') + ' antes de continuar'));
    }
    var lines = calc.lines.map(function (l) {
      return '<div class="discount-item"><div><strong>' + esc(l.name) + '</strong><small>' + l.qty + ' × ' + money(l.price) + '</small></div><span class="amount">' + money(l.line_total) + '</span></div>';
    }).join('');

    openModal('Revisar y registrar',
      '<div class="detail-meta">' +
      '<div><small>Cliente</small><b>' + esc($('client').value || '—') + '</b></div>' +
      '<div><small>Matrícula</small><b>' + esc(($('plate').value || '—').toUpperCase()) + '</b></div>' +
            '<div><small>Convenio</small><b>' + esc(state.discountId ? (state.discounts.filter(function (d) { return d.id === state.discountId; })[0] || {}).name : 'Sin convenio') + '</b></div>' +
      '</div>' + lines +
      (calc.discount ? '<div class="discount-item"><span>Convenio</span><span class="amount danger">−' + money(calc.discount) + '</span></div>' : '') +
      '<div class="summary-total"><span>Total</span><strong>' + money(calc.total) + '</strong></div>' +
      (calc.costConfirmed ? '' : '<p class="status-note">Algún servicio tiene el coste sin confirmar: el margen mostrado es orientativo.</p>') +
      '<div class="form-grid" style="margin-top:18px">' +
      '<label>Método de pago<select id="orderPayment">' + PAYMENTS.map(function (p) { return '<option>' + p + '</option>'; }).join('') + '</select></label>' +
      '<label class="wide">Nota (opcional)<textarea id="orderNote" maxlength="1000" placeholder="Detalles del trabajo"></textarea></label>' +
      '</div><p id="reviewError" class="form-error"></p>' +
      '<div class="form-actions"><button class="secondary" data-close>Volver</button><button class="primary" id="confirmOrder">Registrar orden</button></div>',
      function (body) {
        body.querySelector('#confirmOrder').addEventListener('click', function () { submitOrder(calc); });
      });
  }

  function submitOrder(calc) {
    var payload;
    try {
      payload = OS.validateOrder({
        client: $('client').value,
        plate: $('plate').value,
        model: '',
        payment: $('orderPayment').value,
        note: $('orderNote').value,
        lines: calc.lines.map(function (l) { return { service_id: l.id, qty: String(l.qty) }; })
      });
    } catch (e) {
      $('reviewError').textContent = e.message;
      return;
    }
    payload.request_id = state.requestId || (state.requestId = uuid());
    payload.discount_id = state.discountId || null;

    var button = $('confirmOrder');
    button.disabled = true;
    button.textContent = 'Registrando…';

    db.submitOrder(payload).then(function () {
      state.cart = {}; state.discountId = ''; state.requestId = null;
      ['client', 'plate'].forEach(function (id) {
        $(id).value = ''; $(id).dataset.touched = '';
      });
      closeModal();
      toast('Orden registrada');
      return refreshAll();
    }).catch(function (e) {
      button.disabled = false;
      button.textContent = 'Registrar orden';
      $('reviewError').textContent = (e && e.message) || 'No se pudo registrar la orden';
    });
  }

  /* =================== ÓRDENES DE TRABAJO =================== */
  function filteredOrders() {
    var text = ($('historySearch').value || '').toLowerCase();
    var from = $('historyFrom').value, to = $('historyTo').value;
    var status = $('historyStatus').value;
    return state.orders.filter(function (o) {
      if (status && o.status !== status) return false;
      if (from && dateOnly(o.created_at) < from) return false;
      if (to && dateOnly(o.created_at) > to) return false;
      if (!text) return true;
      return (o.client + ' ' + o.plate + ' ' + o.employee_name + ' #' + o.number)
        .toLowerCase().indexOf(text) >= 0;
    });
  }

  function renderHistory() {
    var rows = filteredOrders();
    var active = rows.filter(function (o) { return o.status === 'active'; });
    $('historyScope').textContent = state.me.role === 'admin'
      ? 'Todas las órdenes del taller' : 'Solo tus órdenes';

    $('historyMetrics').innerHTML = [
      metricCard('Órdenes', rows.length),
      metricCard('Facturado', money(OS.round(active.reduce(function (s, o) { return s + o.total; }, 0)))),
      metricCard('Comisiones', money(OS.round(active.reduce(function (s, o) { return s + o.earning; }, 0)))),
      metricCard('Anuladas', rows.length - active.length)
    ].join('');

    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (state.historyPage >= pages) state.historyPage = pages - 1;
    var page = rows.slice(state.historyPage * PAGE, state.historyPage * PAGE + PAGE);

    $('historyRows').innerHTML = page.length ? page.map(function (o) {
      return '<tr data-order="' + esc(o.id) + '">' +
        '<td><strong>#' + o.number + '</strong><br><small class="muted">' + shortDate(o.created_at) + '</small></td>' +
        '<td>' + esc(o.client) + '</td>' +
        '<td>' + esc(o.plate) + '</td>' +
        '<td>' + esc(o.employee_name) + '</td>' +
        '<td class="amount">' + money(o.total) + '</td>' +
        '<td><span class="tag ' + (o.status === 'void' ? 'void' : '') + '">' + (o.status === 'void' ? 'Anulada' : (o.payout_id ? 'Pagada' : 'Activa')) + '</span></td>' +
        '<td class="row-actions">' + rowActions(o) + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="7"><p class="empty">No hay órdenes con estos filtros.</p></td></tr>';

    $('historyPager').innerHTML = pages > 1
      ? '<button data-page="prev" ' + (state.historyPage ? '' : 'disabled') + '>Anterior</button>' +
        '<span>Página ' + (state.historyPage + 1) + ' de ' + pages + '</span>' +
        '<button data-page="next" ' + (state.historyPage + 1 < pages ? '' : 'disabled') + '>Siguiente</button>'
      : '';
  }

  /* Qué puede hacerse con una orden depende del rol y de su estado:
     una orden anulada ya no se edita, y una incluida en un corte pagado
     no se toca en absoluto. */
  function rowActions(o) {
    var buttons = ['<button class="text-button" data-action="detail">Ver</button>'];
    if (state.me.role !== 'admin') return buttons.join('');
    if (o.status === 'active') {
      buttons.push('<button class="text-button" data-action="edit">Editar</button>');
      if (!o.payout_id) buttons.push('<button class="text-button danger" data-action="void">Anular</button>');
    } else if (!o.payout_id) {
      buttons.push('<button class="text-button danger" data-action="delete">Borrar</button>');
    }
    return buttons.join('');
  }

  function openOrder(id) {
    var o = state.orders.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    var isAdmin = state.me.role === 'admin';
    var items = (o.items || []).map(function (it) {
      return '<div class="discount-item"><div><strong>' + esc(it.name) + '</strong><small>' + it.qty + ' × ' + money(it.price) + '</small></div><span class="amount">' + money(it.line_total) + '</span></div>';
    }).join('');

    openModal('Orden de Trabajo #' + o.number,
      '<div class="detail-meta">' +
      '<div><small>Cliente</small><b>' + esc(o.client) + '</b></div>' +
            '<div><small>Matrícula</small><b>' + esc(o.plate) + '</b></div>' +
      '<div><small>Fecha de entrada</small><b>' + shortDate(o.created_at) + '</b></div>' +
      '<div><small>Empleado</small><b>' + esc(o.employee_name) + '</b></div>' +
      '<div><small>Pago</small><b>' + esc(o.payment) + '</b></div>' +
      '</div>' +
      (o.note ? '<p class="status-note">' + esc(o.note) + '</p>' : '') +
      items +
      (o.discount ? '<div class="discount-item"><span>' + esc(o.discount_name) + '</span><span class="amount danger">−' + money(o.discount) + '</span></div>' : '') +
      '<div class="summary-total"><span>Total</span><strong>' + money(o.total) + '</strong></div>' +
      (o.status === 'void' ? '<p class="status-note">Orden anulada: ' + esc(o.void_reason || '') + '</p>' : '') +
      (o.payout_id ? '<p class="status-note">La comisión de esta orden ya se incluyó en un corte pagado.</p>' : '') +
      (isAdmin ? '<div class="form-actions">' +
        (o.status === 'active' ? '<button class="secondary" id="editOrderBtn">Editar datos</button>' : '') +
        (o.status === 'active' && !o.payout_id ? '<button class="secondary danger" id="voidOrderBtn">Anular orden</button>' : '') +
        (o.status === 'void' && !o.payout_id ? '<button class="secondary danger" id="deleteOrderBtn">Borrar definitivamente</button>' : '') +
        '</div>' : ''),
      function (body) {
        var edit = body.querySelector('#editOrderBtn');
        var vd = body.querySelector('#voidOrderBtn');
        var del = body.querySelector('#deleteOrderBtn');
        if (edit) edit.addEventListener('click', function () { openEditOrder(o); });
        if (vd) vd.addEventListener('click', function () { openVoidOrder(o); });
        if (del) del.addEventListener('click', function () { openDeleteOrder(o); });
      });
  }

  function openEditOrder(o) {
    openModal('Editar orden #' + o.number,
      '<div class="form-grid">' +
      '<label>Cliente<input id="editClient" maxlength="120" value="' + esc(o.client) + '"></label>' +
      '<label>Matrícula<input id="editPlate" maxlength="16" value="' + esc(o.plate) + '"></label>' +
      '<label class="wide">Nota<textarea id="editNote" maxlength="1000">' + esc(o.note || '') + '</textarea></label>' +
      '</div><p id="editError" class="form-error"></p>' +
      '<div class="form-actions"><button class="secondary" data-close>Cancelar</button><button class="primary" id="saveOrder">Guardar cambios</button></div>',
      function (body) {
        body.querySelector('#saveOrder').addEventListener('click', function () {
          db.editOrder(o.id, {
            client: $('editClient').value, plate: $('editPlate').value,
            model: o.model || '', note: $('editNote').value
          }).then(function () {
            closeModal(); toast('Orden actualizada'); return refreshAll();
          }).catch(function (e) { $('editError').textContent = e.message; });
        });
      });
  }

  function openVoidOrder(o) {
    openModal('Anular orden #' + o.number,
      '<p class="muted">La orden deja de contar para facturación y comisiones. Queda registrada en el historial.</p>' +
      '<label>Motivo<textarea id="voidReason" maxlength="300" placeholder="Explica por qué se anula (mínimo 3 caracteres)"></textarea></label>' +
      '<p id="voidError" class="form-error"></p>' +
      '<div class="form-actions"><button class="secondary" data-close>Cancelar</button><button class="primary" id="confirmVoid">Anular orden</button></div>',
      function (body) {
        body.querySelector('#confirmVoid').addEventListener('click', function () {
          db.voidOrder(o.id, $('voidReason').value).then(function () {
            closeModal(); toast('Orden anulada'); return refreshAll();
          }).catch(function (e) { $('voidError').textContent = e.message; });
        });
      });
  }

  function openDeleteOrder(o) {
    openModal('Borrar orden #' + o.number,
      '<p class="status-note danger">Esta acción no se puede deshacer: la orden desaparece de la base de datos. ' +
      'Queda una copia en el historial de cambios, pero no se puede restaurar desde la aplicación.</p>' +
      '<div class="detail-meta">' +
      '<div><small>Cliente</small><b>' + esc(o.client) + '</b></div>' +
      '<div><small>Total</small><b>' + money(o.total) + '</b></div>' +
      '<div><small>Anulada por</small><b>' + esc(o.void_reason || '—') + '</b></div>' +
      '<div><small>Fecha</small><b>' + shortDate(o.created_at) + '</b></div>' +
      '</div>' +
      '<label>Motivo del borrado<textarea id="deleteReason" maxlength="300" placeholder="Ej. orden duplicada por error de captura"></textarea></label>' +
      '<p id="deleteError" class="form-error"></p>' +
      '<div class="form-actions"><button class="secondary" data-close>Cancelar</button>' +
      '<button class="primary" id="confirmDelete">Borrar definitivamente</button></div>',
      function (body) {
        body.querySelector('#confirmDelete').addEventListener('click', function () {
          var button = this;
          button.disabled = true;
          db.deleteOrder(o.id, $('deleteReason').value).then(function () {
            closeModal(); toast('Orden borrada'); return refreshAll();
          }).catch(function (e) {
            button.disabled = false;
            $('deleteError').textContent = e.message;
          });
        });
      });
  }

  function exportOrders() {
    var rows = filteredOrders();
    var header = ['Folio', 'Fecha', 'Cliente', 'Matricula', 'Vehiculo', 'Empleado', 'Subtotal', 'Convenio', 'Total', 'Comision', 'Estado'];
    var body = rows.map(function (o) {
      return [o.number, o.created_at, o.client, o.plate, o.model, o.employee_name,
        o.subtotal, o.discount, o.total, o.earning, o.status].map(OS.csv).join(',');
    });
    var csv = '\ufeff' + header.map(OS.csv).join(',') + '\n' + body.join('\n');
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = 'overspeed-ordenes-' + dateOnly(new Date()) + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ======================== CLIENTES ======================== */
  function renderCustomers() {
    var text = ($('customerSearch').value || '').toLowerCase();
    var byPlate = {};
    state.orders.forEach(function (o) {
      var entry = byPlate[o.plate] || (byPlate[o.plate] = {
        plate: o.plate, model: o.model, client: o.client, count: 0, total: 0, last: o.created_at
      });
      if (new Date(o.created_at) > new Date(entry.last)) {
        entry.last = o.created_at; entry.client = o.client; entry.model = o.model;
      }
      if (o.status === 'active') { entry.count++; entry.total += o.total; }
    });
    var rows = Object.keys(byPlate).map(function (k) { return byPlate[k]; })
      .filter(function (v) {
        if (!text) return true;
        return (v.plate + ' ' + v.client).toLowerCase().indexOf(text) >= 0;
      })
      .sort(function (a, b) { return new Date(b.last) - new Date(a.last); });

    $('customerRows').innerHTML = rows.length ? rows.map(function (v) {
      return '<tr><td><strong>' + esc(v.plate) + '</strong></td>' +
        '<td>' + esc(v.client) + '</td><td>' + v.count + '</td>' +
        '<td class="amount">' + money(OS.round(v.total)) + '</td>' +
        '<td><small class="muted">' + shortDate(v.last) + '</small></td></tr>';
    }).join('') : '<tr><td colspan="5"><p class="empty">Todavía no hay clientes registrados.</p></td></tr>';
  }

  /* ======================== EMPLEADOS ======================== */
  function renderTeam() {
    var start = monthStart();
    $('teamCards').innerHTML = state.profiles.length ? state.profiles.map(function (p) {
      var mine = state.orders.filter(function (o) {
        return o.employee_id === p.id && o.status === 'active' && new Date(o.created_at) >= start;
      });
      var total = OS.round(mine.reduce(function (s, o) { return s + o.total; }, 0));
      return '<article class="person-card">' +
        '<span class="avatar">' + esc(initials(p.name)) + '</span>' +
        '<h3>' + esc(p.name) + '</h3>' +
        '<p>' + (p.role === 'admin' ? 'Administrador' : 'Mecánico') + ' · ' + p.commission + '% comisión' +
        (p.active ? '' : ' · <span class="danger">inactivo</span>') + '</p>' +
        '<span class="amount">' + money(total) + '</span>' +
        '<div class="person-card__actions admin-only">' +
        '<button class="secondary" data-profile="' + esc(p.id) + '">Editar</button>' +
        (p.id === state.me.id ? '' : '<button class="text-button danger" data-delete-profile="' + esc(p.id) + '">Eliminar</button>') +
        '</div>' +
        '</article>';
    }).join('') : '<p class="empty">Sin empleados registrados.</p>';

    $('auditRows').innerHTML = state.audit.length ? state.audit.map(function (a) {
      return '<tr><td><small class="muted">' + shortDate(a.created_at) + '</small></td>' +
        '<td>' + esc(a.actor_name || a.actor_id || '—') + '</td>' +
        '<td>' + esc(a.action) + '</td><td><small class="muted">' + esc(a.entity) + '</small></td></tr>';
    }).join('') : '<tr><td colspan="4"><p class="empty">Sin movimientos registrados.</p></td></tr>';

    applyRole();
  }

  function openDeleteProfile(id) {
    var person = state.profiles.filter(function (p) { return p.id === id; })[0];
    if (!person) return;
    var orders = state.orders.filter(function (o) { return o.employee_id === id; });
    var actives = orders.filter(function (o) { return o.status === 'active'; }).length;

    openModal('Eliminar a ' + person.name,
      (orders.length
        ? '<p class="status-note">' + (actives
            ? 'Tiene <strong>' + actives + ' \u00f3rdenes activas</strong>. Hay que anularlas antes de poder eliminarlo.'
            : 'Tiene <strong>' + orders.length + ' \u00f3rdenes en el historial</strong>. Lo habitual en ese caso es ' +
              'desactivar la cuenta: eliminarla borrar\u00eda el rastro de trabajos ya facturados.') + '</p>'
        : '<p class="status-note danger">Se elimina el perfil y tambi\u00e9n su usuario, que quedar\u00e1 libre ' +
          'para volver a usarse. Queda una copia en el historial de cambios.</p>') +
      '<div class="detail-meta">' +
      '<div><small>Usuario</small><b>' + esc(toUser(person.email) || '\u2014') + '</b></div>' +
      '<div><small>Rol</small><b>' + (person.role === 'admin' ? 'Administrador' : 'Mec\u00e1nico') + '</b></div>' +
      '<div><small>\u00d3rdenes</small><b>' + orders.length + '</b></div>' +
      '<div><small>Activas</small><b>' + actives + '</b></div>' +
      '</div>' +
      '<p id="delProfileError" class="form-error"></p>' +
      '<div class="form-actions"><button class="secondary" data-close>Cancelar</button>' +
      (orders.length
        ? '<button class="secondary" id="deactivateProfile">Desactivar cuenta</button>'
        : '<button class="primary" id="confirmDeleteProfile">Eliminar empleado</button>') +
      '</div>',
      function (body) {
        var remove = body.querySelector('#confirmDeleteProfile');
        var off = body.querySelector('#deactivateProfile');
        if (remove) remove.addEventListener('click', function () {
          remove.disabled = true;
          db.deleteProfile(id).then(function () {
            closeModal(); toast('Empleado eliminado'); return refreshAll();
          }).catch(function (e) {
            remove.disabled = false;
            $('delProfileError').textContent = e.message;
          });
        });
        if (off) off.addEventListener('click', function () {
          off.disabled = true;
          db.manage('profile', {
            id: person.id, name: person.name, role: person.role,
            commission: person.commission, active: false
          }).then(function () {
            closeModal(); toast('Cuenta desactivada'); return refreshAll();
          }).catch(function (e) {
            off.disabled = false;
            $('delProfileError').textContent = e.message;
          });
        });
      });
  }

  function openProfile(id) {
    var p = state.profiles.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    openModal('Editar empleado',
      '<div class="form-grid">' +
      '<label class="wide">Nombre<input id="pName" maxlength="100" value="' + esc(p.name) + '"></label>' +
      '<label>Rol<select id="pRole"><option value="employee">Mecánico</option><option value="admin">Administrador</option></select></label>' +
      '<label>Comisión (%)<input id="pCommission" type="number" min="0" max="100" step="0.5" value="' + p.commission + '"></label>' +
      '<label class="wide inline-check"><input id="pActive" type="checkbox" ' + (p.active ? 'checked' : '') + '> Cuenta activa</label>' +
      '</div><p id="pError" class="form-error"></p>' +
      '<div class="form-actions"><button class="secondary" data-close>Cancelar</button><button class="primary" id="saveProfile">Guardar</button></div>',
      function (body) {
        body.querySelector('#pRole').value = p.role;
        body.querySelector('#saveProfile').addEventListener('click', function () {
          db.manage('profile', {
            id: p.id, name: $('pName').value, role: $('pRole').value,
            commission: Number($('pCommission').value), active: $('pActive').checked
          }).then(function () {
            closeModal(); toast('Empleado actualizado'); return refreshAll();
          }).catch(function (e) { $('pError').textContent = e.message; });
        });
      });
  }

  /* Convierte "Ana Torres" en "ana.torres". */
  function slugUser(name) {
    var clean = String(name || '');
    if (clean.normalize) clean = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return clean.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '.');
  }

  /* El proyecto tiene activada la verificacion de cuentas nuevas. Es un
     ajuste que solo hay que tocar una vez, al poner en marcha el taller. */
  function warnConfirmation(user) {
    openModal('Empleado creado, pero a\u00fan no puede entrar',
      '<p class="status-note danger">El usuario <strong>' + esc(user) + '</strong> qued\u00f3 guardado, ' +
      'pero tu proyecto de Supabase tiene activada la verificaci\u00f3n de cuentas nuevas y eso le impide ' +
      'iniciar sesi\u00f3n.</p>' +
      '<p>Se desactiva una sola vez y vale para todos los empleados que crees despu\u00e9s:</p>' +
      '<ol style="line-height:1.9;color:var(--dim);padding-left:20px">' +
      '<li>Supabase \u203a Authentication \u203a Providers \u203a Email.</li>' +
      '<li>Desactiva <strong>Confirm email</strong> y guarda.</li>' +
      '<li>Para las cuentas que ya creaste, ejecuta esto en el SQL Editor:<br>' +
      '<code>update auth.users set email_confirmed_at = now() where email_confirmed_at is null;</code></li>' +
      '</ol>' +
      '<div class="form-actions"><button class="primary" data-close>Entendido</button></div>');
  }

  function openNewEmployee() {
    openModal('Nuevo empleado',
      '<div class="form-grid">' +
      '<label class="wide">Nombre<input id="nName" maxlength="100" placeholder="Nombre y apellidos"></label>' +
      '<label class="wide">Usuario<input id="nEmail" maxlength="40" placeholder="ana.torres" autocomplete="off"></label>' +
      '<label class="wide">Contraseña inicial<input id="nPassword" type="text" minlength="8" placeholder="Mínimo 8 caracteres" autocomplete="off"></label>' +
      '<label>Rol<select id="nRole"><option value="employee">Mecánico</option><option value="admin">Administrador</option></select></label>' +
      '<label>Comisión (%)<input id="nCommission" type="number" min="0" max="100" step="0.5" value="10"></label>' +
      '</div>' +
      '<p class="hint">El usuario se propone a partir del nombre y es con lo que iniciará sesión. ' +
      'Solo tiene que ser único. Pásale la contraseña para que la cambie en su primer acceso.</p>' +
      '<p id="nError" class="form-error"></p>' +
      '<div class="form-actions"><button class="secondary" data-close>Cancelar</button>' +
      '<button class="primary" id="saveNewEmployee">Crear empleado</button></div>',
      function (body) {
        // El usuario se propone solo mientras no se escriba a mano.
        $('nName').addEventListener('input', function () {
          var field = $('nEmail');
          if (field.dataset.touched === '1') return;
          field.value = slugUser(this.value);
        });
        $('nEmail').addEventListener('input', function () { this.dataset.touched = '1'; });

        body.querySelector('#saveNewEmployee').addEventListener('click', function () {
          var button = this;
          var name = $('nName').value.trim();
          var user = $('nEmail').value.trim().toLowerCase();
          var email = toEmail(user);
          var password = $('nPassword').value;

          if (name.length < 1 || name.length > 100) return show('Escribe el nombre del empleado');
          if (!/^[a-z0-9._-]{3,40}$/.test(user)) {
            return show('El usuario solo admite letras, números, puntos, guiones y guiones bajos (mínimo 3)');
          }
          if (password.length < 8) return show('La contraseña debe tener al menos 8 caracteres');

          button.disabled = true;
          button.textContent = 'Creando…';
          var needsConfirm = false;
          db.createAccount(email, password).then(function (pending) {
            needsConfirm = pending === true;
            return db.manage('profile_create', {
              name: name, email: email, role: $('nRole').value,
              commission: Number($('nCommission').value)
            });
          }).then(function () {
            closeModal();
            if (needsConfirm) warnConfirmation(user);
            else toast('Empleado creado');
            return refreshAll();
          }).catch(function (e) {
            button.disabled = false;
            button.textContent = 'Crear empleado';
            show(traducir(String((e && e.message) || '')) || 'No se pudo crear el empleado');
          });

          function show(message) {
            $('nError').textContent = message;
            button.disabled = false;
            button.textContent = 'Crear empleado';
          }
        });
      });
  }

  /* ======================= ESTADÍSTICAS ====================== */
  function renderStats() {
    var monthValue = $('statsMonth').value || OS.month(new Date());
    $('statsMonth').value = monthValue;
    var start = new Date(monthValue + '-01T00:00:00');
    var end = new Date(start); end.setMonth(end.getMonth() + 1);

    var rows = state.orders.filter(function (o) {
      var d = new Date(o.created_at);
      return o.status === 'active' && d >= start && d < end;
    });
    var total = OS.round(rows.reduce(function (s, o) { return s + o.total; }, 0));
    var cost = OS.round(rows.reduce(function (s, o) { return s + o.cost; }, 0));
    var earning = OS.round(rows.reduce(function (s, o) { return s + o.earning; }, 0));

    $('statsScope').textContent = state.me.role === 'admin' ? 'Datos de todo el taller' : 'Tus datos';
    $('statsMetrics').innerHTML = [
      metricCard('Órdenes', rows.length, 'accent'),
      metricCard('Facturado', money(total)),
      metricCard('Coste de piezas', money(cost)),
      metricCard('Margen neto', money(OS.round(total - cost - earning)))
    ].join('');

    // Facturación por día
    var days = new Date(end - 1).getDate(), series = [], labels = [];
    for (var d = 1; d <= days; d++) {
      var key = monthValue + '-' + String(d).padStart(2, '0');
      series.push(OS.round(rows.reduce(function (s, o) { return dateOnly(o.created_at) === key ? s + o.total : s; }, 0)));
      labels.push(d % 5 === 0 || d === 1 ? String(d) : '');
    }
    $('revenueChart').innerHTML = barChart(series, labels);

    // Ranking de servicios
    var byService = {};
    rows.forEach(function (o) {
      (o.items || []).forEach(function (it) {
        var e = byService[it.name] || (byService[it.name] = { qty: 0, total: 0 });
        e.qty += it.qty; e.total += it.line_total;
      });
    });
    var ranked = Object.keys(byService).sort(function (a, b) { return byService[b].total - byService[a].total; }).slice(0, 8);
    $('serviceRanking').innerHTML = ranked.length ? ranked.map(function (name) {
      return '<div class="rank-row"><div>' + esc(name) + '<small>' + byService[name].qty + ' unidades</small></div>' +
        '<b>' + money(OS.round(byService[name].total)) + '</b></div>';
    }).join('') : '<p class="empty">Sin servicios en este mes.</p>';

    // Ranking de empleados
    var byEmployee = {};
    rows.forEach(function (o) {
      var e = byEmployee[o.employee_name] || (byEmployee[o.employee_name] = { count: 0, total: 0 });
      e.count++; e.total += o.total;
    });
    var people = Object.keys(byEmployee).sort(function (a, b) { return byEmployee[b].total - byEmployee[a].total; });
    $('performanceTitle').textContent = state.me.role === 'admin' ? 'Rendimiento por empleado' : 'Tu rendimiento';
    $('employeeRanking').innerHTML = people.length ? people.map(function (name) {
      return '<div class="rank-row"><div>' + esc(name) + '<small>' + byEmployee[name].count + ' órdenes</small></div>' +
        '<b>' + money(OS.round(byEmployee[name].total)) + '</b></div>';
    }).join('') : '<p class="empty">Sin actividad en este mes.</p>';
  }

  function barChart(values, labels) {
    var w = 640, h = 210, pad = 34;
    var max = Math.max.apply(null, values.concat([1]));
    var slot = (w - pad * 2) / values.length;
    var bars = values.map(function (v, i) {
      var height = (v / max) * (h - pad * 2);
      return '<rect x="' + (pad + i * slot + slot * 0.18).toFixed(1) + '" y="' + (h - pad - height).toFixed(1) +
        '" width="' + (slot * 0.64).toFixed(1) + '" height="' + Math.max(height, 1).toFixed(1) + '" rx="2"/>';
    }).join('');
    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var y = pad + g * (h - pad * 2) / 4;
      grid += '<line x1="' + pad + '" y1="' + y + '" x2="' + (w - pad) + '" y2="' + y + '"/>' +
        '<text x="4" y="' + (y + 3) + '">' + Math.round(max - g * max / 4) + '</text>';
    }
    var ticks = labels.map(function (t, i) {
      return t ? '<text x="' + (pad + i * slot + slot / 2) + '" y="' + (h - 10) + '" text-anchor="middle">' + esc(t) + '</text>' : '';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + grid + bars + ticks + '</svg>';
  }

  /* ========================== PAGOS ========================== */
  function renderPayouts() {
    var isAdmin = state.me.role === 'admin';
    var pending = {};
    state.orders.forEach(function (o) {
      if (o.status !== 'active' || o.payout_id) return;
      var e = pending[o.employee_id] || (pending[o.employee_id] = { name: o.employee_name, count: 0, amount: 0 });
      e.count++; e.amount += o.earning;
    });
    var ids = Object.keys(pending);
    $('pendingPayments').innerHTML = ids.length ? ids.map(function (id) {
      var e = pending[id];
      return '<article class="person-card">' +
        '<span class="avatar">' + esc(initials(e.name)) + '</span>' +
        '<h3>' + esc(e.name) + '</h3><p>' + e.count + ' órdenes sin liquidar</p>' +
        '<span class="amount">' + money(OS.round(e.amount)) + '</span>' +
        (isAdmin ? '<button class="primary" data-pay="' + esc(id) + '">Registrar pago</button>' : '') +
        '</article>';
    }).join('') : '<p class="empty">No hay comisiones pendientes.</p>';

    $('payoutRows').innerHTML = state.payouts.length ? state.payouts.map(function (p) {
      return '<tr><td><small class="muted">' + shortDate(p.created_at) + '</small></td>' +
        '<td>' + esc(p.employee_name) + '</td>' +
        '<td>' + (p.order_ids || []).length + '</td>' +
        '<td class="amount">' + money(p.amount) + '</td>' +
        '<td><span class="tag">Pagado</span></td></tr>';
    }).join('') : '<tr><td colspan="5"><p class="empty">Sin cortes registrados.</p></td></tr>';
  }

  /* =================== INVENTARIO / PIEZAS =================== */
  function renderCatalog() {
    $('catalogRows').innerHTML = state.services.length ? state.services.map(function (s) {
      return '<tr><td><strong>' + esc(s.name) + '</strong>' +
        (s.description ? '<br><small class="muted">' + esc(s.description) + '</small>' : '') + '</td>' +
        '<td>' + esc(s.category) + '</td>' +
        '<td>' + money(s.cost) + (s.cost_confirmed === false ? ' <span class="tag neutral">sin confirmar</span>' : '') + '</td>' +
        '<td class="amount">' + money(s.price) + '</td>' +
        '<td><span class="tag ' + (s.active === false ? 'void' : '') + '">' + (s.active === false ? 'Inactivo' : 'Activo') + '</span></td>' +
        '<td><button class="text-button admin-only" data-service-edit="' + esc(s.id) + '">Editar</button></td></tr>';
    }).join('') : '<tr><td colspan="6"><p class="empty">Sin servicios en el catálogo.</p></td></tr>';

    $('discountRows').innerHTML = state.discounts.length ? '<div class="deal-grid">' +
      state.discounts.map(function (d) {
        return '<article class="deal-card' + (d.active ? '' : ' is-off') + '">' +
          logoTile(d, 48) +
          '<div class="deal-card__body">' +
          '<strong>' + esc(d.name) + '</strong>' +
          '<small>' + (d.admin_only ? 'Solo administradores' : 'Todo el equipo') +
          (d.active ? '' : ' · inactivo') + '</small>' +
          '</div>' +
          '<span class="deal-card__percent">−' + d.percent + '%</span>' +
          '<button class="text-button admin-only" data-discount-edit="' + esc(d.id) + '">Editar</button>' +
          '</article>';
      }).join('') + '</div>' : '<p class="empty">Todavía no hay convenios.<br>Crea el primero con «Nuevo convenio» y súbele el logo de la empresa.</p>';

    applyRole();
  }

  function openService(id) {
    var s = state.services.filter(function (x) { return x.id === id; })[0] ||
      { id: '', name: '', category: 'Mantenimiento', cost: 0, price: 0, description: '', active: true, cost_confirmed: true };
    openModal(id ? 'Editar pieza o servicio' : 'Nueva pieza o servicio',
      '<div class="form-grid">' +
      '<label class="wide">Nombre<input id="sName" maxlength="120" value="' + esc(s.name) + '"></label>' +
      '<label>Categoría<select id="sCategory">' + CATEGORIES.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></label>' +
      '<label>Coste<input id="sCost" type="number" min="0" step="0.01" value="' + s.cost + '"></label>' +
      '<label>Precio<input id="sPrice" type="number" min="0" step="0.01" value="' + s.price + '"></label>' +
      '<label class="wide">Descripción<textarea id="sDescription" maxlength="500">' + esc(s.description || '') + '</textarea></label>' +
      '<label class="inline-check"><input id="sActive" type="checkbox" ' + (s.active !== false ? 'checked' : '') + '> Activo</label>' +
      '<label class="inline-check"><input id="sConfirmed" type="checkbox" ' + (s.cost_confirmed !== false ? 'checked' : '') + '> Coste confirmado</label>' +
      '</div><p id="sError" class="form-error"></p>' +
      '<div class="form-actions"><button class="secondary" data-close>Cancelar</button><button class="primary" id="saveService">Guardar</button></div>',
      function (body) {
        body.querySelector('#sCategory').value = s.category;
        body.querySelector('#saveService').addEventListener('click', function () {
          db.manage('service', {
            id: s.id || '', name: $('sName').value, category: $('sCategory').value,
            cost: Number($('sCost').value), price: Number($('sPrice').value),
            description: $('sDescription').value,
            active: $('sActive').checked, cost_confirmed: $('sConfirmed').checked
          }).then(function () {
            closeModal(); toast('Catálogo actualizado'); return refreshAll();
          }).catch(function (e) { $('sError').textContent = e.message; });
        });
      });
  }

  function openDiscount(id) {
    var d = state.discounts.filter(function (x) { return x.id === id; })[0] ||
      { id: '', name: '', percent: 5, active: true, admin_only: true, logo_url: '' };
    var logo = d.logo_url || '';

    openModal(id ? 'Editar convenio' : 'Nuevo convenio',
      '<div class="logo-field">' +
      '<span class="logo-drop" id="dLogoPreview">' + logoTile({ name: d.name || '?', logo_url: logo }, 88) + '</span>' +
      '<div class="logo-field__side">' +
      '<p class="muted">Logotipo de la empresa con la que tienes el convenio. PNG, JPG o WebP, hasta 2 MB.</p>' +
      '<div class="logo-field__buttons">' +
      '<button class="secondary" id="dPickLogo" type="button">Subir imagen</button>' +
      '<button class="text-button" id="dClearLogo" type="button"' + (logo ? '' : ' hidden') + '>Quitar</button>' +
      '</div>' +
      '<input id="dLogoFile" type="file" accept="image/png,image/jpeg,image/webp" hidden>' +
      '</div></div>' +
      '<div class="form-grid">' +
      '<label class="wide">Nombre del convenio<input id="dName" maxlength="100" value="' + esc(d.name) + '" placeholder="Ej. Taller Grotti"></label>' +
      '<label>Descuento (%)<input id="dPercent" type="number" min="0" max="100" step="0.5" value="' + d.percent + '"></label>' +
      '<label class="inline-check"><input id="dActive" type="checkbox" ' + (d.active ? 'checked' : '') + '> Activo</label>' +
      '<label class="inline-check wide"><input id="dAdmin" type="checkbox" ' + (d.admin_only ? 'checked' : '') + '> Solo administradores pueden aplicarlo</label>' +
      '</div><p id="dError" class="form-error"></p>' +
      '<div class="form-actions"><button class="secondary" data-close>Cancelar</button><button class="primary" id="saveDiscount">Guardar convenio</button></div>',

      function (body) {
        var file = $('dLogoFile');
        var preview = $('dLogoPreview');
        var clear = $('dClearLogo');
        var save = $('saveDiscount');

        function paint() {
          preview.innerHTML = logoTile({ name: $('dName').value || '?', logo_url: logo }, 88);
          clear.hidden = !logo;
        }
        $('dPickLogo').addEventListener('click', function () { file.click(); });
        clear.addEventListener('click', function () { logo = ''; paint(); });
        $('dName').addEventListener('input', paint);

        file.addEventListener('change', function () {
          var chosen = file.files && file.files[0];
          if (!chosen) return;
          $('dError').textContent = '';
          save.disabled = true;
          preview.classList.add('is-loading');
          uploadLogo(chosen, d.id).then(function (url) {
            logo = url; paint();
          }).catch(function (e) {
            $('dError').textContent = e.message || 'No se pudo subir el logo';
          }).then(function () {
            save.disabled = false;
            preview.classList.remove('is-loading');
            file.value = '';
          });
        });

        save.addEventListener('click', function () {
          save.disabled = true;
          db.manage('discount', {
            id: d.id || '', name: $('dName').value, percent: Number($('dPercent').value),
            active: $('dActive').checked, admin_only: $('dAdmin').checked, logo_url: logo
          }).then(function () {
            closeModal(); toast('Convenio guardado'); return refreshAll();
          }).catch(function (e) {
            save.disabled = false;
            $('dError').textContent = e.message;
          });
        });
      });
  }

  function openFeatured() {
    var people = state.profiles.filter(function (p) { return p.active; });
    openModal('Empleado del mes',
      '<div class="form-grid">' +
      '<label class="wide">Empleado<select id="fEmployee">' + people.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="wide">Foto (URL https)<input id="fPhoto" type="url" placeholder="https://…"></label>' +
      '<label class="wide">Nota<input id="fNote" maxlength="200" placeholder="Mayor facturación del mes"></label>' +
      '</div><p id="fError" class="form-error"></p>' +
      '<div class="form-actions"><button class="secondary" data-close>Cancelar</button><button class="primary" id="saveFeatured">Guardar</button></div>',
      function (body) {
        body.querySelector('#saveFeatured').addEventListener('click', function () {
          var month = new Date(); month.setDate(1);
          db.manage('featured', {
            month: dateOnly(month), employee_id: $('fEmployee').value,
            photo_url: $('fPhoto').value, note: $('fNote').value
          }).then(function () {
            closeModal(); toast('Empleado del mes actualizado'); return refreshAll();
          }).catch(function (e) { $('fError').textContent = e.message; });
        });
      });
  }

  /* ========================== AJUSTES ======================== */
  function renderSettings() {
    var cfg = readConfig();
    var isAdmin = state.me.role === 'admin';

    $('settingsAccount').innerHTML =
      '<div class="detail-meta">' +
      '<div><small>Nombre</small><b>' + esc(state.me.name) + '</b></div>' +
      '<div><small>Usuario</small><b>' + esc(toUser(state.me.email) || '—') + '</b></div>' +
      '<div><small>Rol</small><b>' + (isAdmin ? 'Administrador' : 'Mecánico') + '</b></div>' +
      '<div><small>Comisión</small><b>' + state.me.commission + '%</b></div>' +
      '</div>';

    $('settingsConnection').innerHTML = state.mode === 'demo'
      ? '<p class="status-note">Estás en la <strong>demo local</strong>. Los datos viven solo en este navegador ' +
        'y no se sincronizan con nadie. Cierra sesión para conectarte a Supabase.</p>' +
        '<div class="form-actions"><button class="secondary" id="settingsResetDemo">Restablecer datos de demo</button></div>'
      : '<div class="detail-meta">' +
        '<div><small>Proyecto</small><b>' + esc(cfg.supabaseUrl || '—') + '</b></div>' +
        '<div><small>Estado</small><b class="ok">Conectado</b></div>' +
        '</div>' +
        '<p class="hint">La clave pública se guarda en este navegador. Para cambiar de proyecto, ' +
        'cierra sesión y usa «Configurar conexión» en la pantalla de acceso.</p>';

    var services = state.services.length;
    var unconfirmed = state.services.filter(function (x) { return x.cost_confirmed === false; }).length;
    $('settingsData').innerHTML =
      '<div class="rank-row"><div>Piezas y servicios<small>' + unconfirmed + ' con el coste sin confirmar</small></div><b>' + services + '</b></div>' +
      '<div class="rank-row"><div>Convenios<small>' + state.discounts.filter(function (d) { return d.active; }).length + ' activos</small></div><b>' + state.discounts.length + '</b></div>' +
      '<div class="rank-row"><div>Órdenes cargadas<small>' + (isAdmin ? 'Todo el taller' : 'Solo las tuyas') + '</small></div><b>' + state.orders.length + '</b></div>' +
      '<div class="form-actions"><button class="secondary" id="settingsExport">Exportar órdenes a CSV</button>' +
      '<button class="secondary" id="settingsRefresh">Recargar datos</button></div>';
  }

  /* ===================== notificaciones ====================== */
  function openNotifications() {
    var pendingOrders = state.orders.filter(function (o) {
      return o.status === 'active' && !o.payout_id;
    });
    var owed = OS.round(pendingOrders.reduce(function (s, o) { return s + o.earning; }, 0));
    var unconfirmed = state.services.filter(function (x) { return x.cost_confirmed === false && x.active !== false; });
    var noLogo = state.discounts.filter(function (d) { return d.active && !d.logo_url; });

    var blocks = [];
    if (pendingOrders.length) {
      blocks.push(note('Comisiones sin liquidar',
        pendingOrders.length + ' órdenes acumulan ' + money(owed) + ' pendientes de corte.', 'payouts'));
    }
    if (unconfirmed.length) {
      blocks.push(note('Costes sin confirmar',
        unconfirmed.length + ' piezas tienen el coste marcado como orientativo, así que el margen no es exacto.', 'catalog'));
    }
    if (noLogo.length) {
      blocks.push(note('Convenios sin logotipo',
        noLogo.length + ' convenios activos no tienen imagen de la empresa.', 'catalog'));
    }

    openModal('Avisos', blocks.length
      ? blocks.join('')
      : '<p class="empty">Nada pendiente. Todo al día.</p>',
      function (body) {
        Array.prototype.forEach.call(body.querySelectorAll('[data-goto]'), function (button) {
          button.addEventListener('click', function () {
            closeModal();
            setView(button.dataset.goto);
          });
        });
      });

    function note(title, text, view) {
      return '<div class="notice"><div><strong>' + esc(title) + '</strong><p>' + esc(text) + '</p></div>' +
        '<button class="text-button" data-goto="' + view + '">Ver</button></div>';
    }
  }

  /* ========================= eventos ========================= */
  function bind() {
    $('loginForm').addEventListener('submit', doLogin);
    $('logoutBtn').addEventListener('click', logout);
    $('refreshAll').addEventListener('click', function () { refreshAll().then(function () { toast('Datos actualizados'); }); });

    $('notifyBtn').addEventListener('click', openNotifications);
    $('settingsBtn').addEventListener('click', function () { setView('settings'); });

    // Botones que aparecen dentro de la vista Ajustes
    $('view-settings').addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var button = e.target.closest('button');
      if (!button) return;
      if (button.id === 'settingsExport') exportOrders();
      else if (button.id === 'settingsRefresh') refreshAll().then(function () { toast('Datos actualizados'); });
      else if (button.id === 'settingsResetDemo') { demo.reset(); startDemo(); toast('Demo restablecida'); }
    });

    $('accountBtn').addEventListener('click', function () {
      openModal('Mi cuenta',
        '<div class="detail-meta">' +
        '<div><small>Nombre</small><b>' + esc(state.me.name) + '</b></div>' +
        '<div><small>Usuario</small><b>' + esc(toUser(state.me.email) || '—') + '</b></div>' +
        '<div><small>Rol</small><b>' + (state.me.role === 'admin' ? 'Administrador' : 'Mecánico') + '</b></div>' +
        '<div><small>Comisión</small><b>' + state.me.commission + '%</b></div>' +
        '</div>' +
        '<p class="status-note">' + (state.mode === 'demo'
          ? 'Estás en la demo local: los datos viven solo en este navegador.'
          : 'Sesión conectada a Supabase.') + '</p>' +
        '<div class="form-actions"><button class="primary" data-close>Cerrar</button></div>');
    });

    // Navegación
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      var nav = e.target.closest('[data-view]');
      if (nav && !nav.disabled) { setView(nav.dataset.view); return; }
      if (e.target.closest('[data-close]')) { closeModal(); return; }
    });
    $('closeModal').addEventListener('click', closeModal);

    // Demo
    $('demoRoleBtn').addEventListener('click', function () {
      state.demoRole = state.demoRole === 'admin' ? 'employee' : 'admin';
      this.textContent = state.demoRole === 'admin' ? 'Ver como empleado' : 'Ver como administrador';
      startDemo();
    });
    $('resetDemoBtn').addEventListener('click', function () {
      demo.reset(); startDemo(); toast('Demo restablecida');
    });

    // TPV
    $('serviceSearch').addEventListener('input', renderWorkshop);
    $('categories').addEventListener('click', function (e) {
      var button = e.target.closest('[data-cat]');
      if (!button) return;
      state.category = button.dataset.cat;
      renderWorkshop();
    });
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      var hotspot = e.target.closest('.hotspot');
      if (hotspot) { state.category = hotspot.dataset.category; renderWorkshop(); }
    });
    // Teclear unidades: si la pieza ya está en la orden, se actualiza al vuelo.
    $('serviceRows').addEventListener('input', function (e) {
      if (!e.target.closest) return;
      var input = e.target.closest('[data-action="qty"]');
      if (!input) return;
      var row = e.target.closest('[data-service]');
      var id = row.dataset.service;
      // El campo indica cuántas unidades añadirá el botón rojo; la orden
      // solo cambia al pulsar + o ✕.
      if (Number(input.value) < 1) input.value = 1;
    });

    // Flechas propias y botón rojo de añadir o quitar.
    $('serviceRows').addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var button = e.target.closest('[data-action]');
      var row = e.target.closest('[data-service]');
      if (!button || !row) return;
      var id = row.dataset.service;
      var input = row.querySelector('.unit-input');
      var action = button.dataset.action;

      if (action === 'up' || action === 'down') {
        // Las flechas solo ajustan cuántas unidades añadirá el botón rojo.
        var next = Math.floor(Number(input.value) || 1) + (action === 'up' ? 1 : -1);
        input.value = Math.min(9999, Math.max(1, next));
      } else if (action === 'add') {
        var units = Math.max(1, Math.floor(Number(input.value) || 1));
        state.cart[id] = Math.min(9999, (state.cart[id] || 0) + units);
        touchRow(row, id);
      } else if (action === 'remove') {
        delete state.cart[id];
        touchRow(row, id);
      }
    });
    $('discountSelect').addEventListener('change', function () {
      state.discountId = this.value; renderWorkshop();
    });
    // Quitar una línea suelta desde el ticket
    $('orderItems').addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var button = e.target.closest('[data-remove-line]');
      if (!button) return;
      delete state.cart[button.dataset.removeLine];
      renderWorkshop();
    });
    $('clearOrder').addEventListener('click', function () {
      state.cart = {}; state.discountId = ''; state.requestId = null;
      ['client', 'plate'].forEach(function (id) { $(id).dataset.touched = ''; });
      renderWorkshop();
    });
    ['client', 'plate'].forEach(function (id) {
      var field = $(id);
      field.addEventListener('input', function () { updateQuote(); });
      field.addEventListener('blur', function () {
        field.dataset.touched = '1';
        paintVehicleFields();
      });
    });
    $('plate').addEventListener('blur', function () {
      this.value = this.value.trim().toUpperCase();
      updateQuote();
    });
    $('reviewBtn').addEventListener('click', openReview);
    $('featureEdit').addEventListener('click', openFeatured);

    // Órdenes
    ['historySearch', 'historyFrom', 'historyTo', 'historyStatus'].forEach(function (id) {
      $(id).addEventListener('input', function () { state.historyPage = 0; renderHistory(); });
    });
    $('historyRows').addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var row = e.target.closest('[data-order]');
      var button = e.target.closest('[data-action]');
      if (!row || !button) return;
      var order = state.orders.filter(function (o) { return o.id === row.dataset.order; })[0];
      if (!order) return;
      var action = button.dataset.action;
      if (action === 'detail') openOrder(order.id);
      else if (action === 'edit') openEditOrder(order);
      else if (action === 'void') openVoidOrder(order);
      else if (action === 'delete') openDeleteOrder(order);
    });
    $('historyPager').addEventListener('click', function (e) {
      var button = e.target.closest('[data-page]');
      if (!button) return;
      state.historyPage += button.dataset.page === 'next' ? 1 : -1;
      if (state.historyPage < 0) state.historyPage = 0;
      renderHistory();
    });
    $('exportOrders').addEventListener('click', exportOrders);

    // Clientes
    $('customerSearch').addEventListener('input', renderCustomers);

    // Equipo
    $('addEmployee').addEventListener('click', openNewEmployee);
    $('refreshAudit').addEventListener('click', function () { refreshAll(); });
    $('teamCards').addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var edit = e.target.closest('[data-profile]');
      if (edit) { openProfile(edit.dataset.profile); return; }
      var remove = e.target.closest('[data-delete-profile]');
      if (remove) openDeleteProfile(remove.dataset.deleteProfile);
    });

    // Estadísticas
    $('statsMonth').addEventListener('change', renderStats);

    // Pagos
    $('pendingPayments').addEventListener('click', function (e) {
      var button = e.target.closest('[data-pay]');
      if (!button) return;
      button.disabled = true;
      db.payEmployee(button.dataset.pay).then(function () {
        toast('Pago registrado'); return refreshAll();
      }).catch(function (e2) { button.disabled = false; fail(e2); });
    });

    // Catálogo
    $('addService').addEventListener('click', function () { openService(''); });
    $('addDiscount').addEventListener('click', function () { openDiscount(''); });
    $('catalogRows').addEventListener('click', function (e) {
      var button = e.target.closest('[data-service-edit]');
      if (button) openService(button.dataset.serviceEdit);
    });
    $('discountRows').addEventListener('click', function (e) {
      var button = e.target.closest('[data-discount-edit]');
      if (button) openDiscount(button.dataset.discountEdit);
    });
  }

  /* ========================== arranque ======================= */
  function start() {
    bind();
    $('statsMonth').value = OS.month(new Date());
    // La demo queda accesible solo para pruebas internas, abriendo la
    // aplicación con #demo al final de la dirección.
    if (location.hash.replace('#', '').toLowerCase() === 'demo') {
      startDemo();
      return;
    }

    state.client = makeClient();
    if (!state.client) {
      showGate('Falta configurar la conexión con Supabase en config.js.', true);
      return;
    }
    // Si Supabase invalida la sesión (token caducado, contraseña cambiada),
    // se vuelve a la pantalla de acceso en lugar de quedar la interfaz muerta.
    state.client.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT' && state.mode === 'supabase' && state.me) {
        state.me = null; state.mode = null; state.cart = {};
        showGate('Tu sesión ha caducado. Vuelve a iniciar sesión.', true);
      }
    });

    // Reanuda la sesión si el navegador ya tenía uno válido.
    state.client.auth.getSession().then(function (res) {
      if (!res.data || !res.data.session) { showGate(''); return; }
      state.mode = 'supabase';
      return loadProfile().then(enter);
    }).catch(function (e) { showGate(e.message || '', true); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
