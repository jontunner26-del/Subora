/* =====================================================================
   subora-api.js  -  Supabase client layer for the Subora marketplace
   Usage in your HTML (before your main <script>):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
     <script src="subora-api.js"></script>
   Then call e.g.  await Subora.auth.signIn(email, pw)  /  await Subora.market.list({cat:'Courses'})
   NOTE: the anon key is designed to be public. Security comes from the RLS
   policies in subora_schema.sql. NEVER put the service_role key in this file.
   ===================================================================== */
(function () {
  const SUPABASE_URL = 'https://znywpatsqmmxkbqtybrr.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpueXdwYXRzcW1teGticXR5YnJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzAxODEsImV4cCI6MjEwNzY0NjE4MX0.F3XtaNmuOXFsC8r6UjfbtnZdxoz0HDUDtieY6bSyqqc';

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  // Throw on error so callers can use try/catch + toast(e.message)
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const rpc = (fn, args) => sb.rpc(fn, args).then(ok);

  const auth = {
    // role: 'buyer' | 'vendor'  (admin can only be granted in the database)
    async signUp({ email, password, fullName, username, role = 'buyer', storeName, ref }) {
      return ok(await sb.auth.signUp({
        email, password,
        options: { data: { full_name: fullName, username, role, store_name: storeName, ref } }
      }));
    },
    async signIn(email, password) { return ok(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { return ok(await sb.auth.signOut()); },
    async forgot(email) { return ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin })); },
    async session() { return (await sb.auth.getSession()).data.session; },
    onChange(cb) { return sb.auth.onAuthStateChange((_e, s) => cb(s)); },
    async me() {
      const s = await auth.session(); if (!s) return null;
      const profile = ok(await sb.from('profiles').select('*').eq('id', s.user.id).single());
      let vendor = null;
      if (profile.role === 'vendor') vendor = ok(await sb.from('vendors').select('*').eq('id', s.user.id).single());
      return { user: s.user, profile, vendor };
    },
    async updateProfile(patch) {
      const s = await auth.session();
      return ok(await sb.from('profiles').update(patch).eq('id', s.user.id).select().single());
    }
  };

  const market = {
    categories: async () => ok(await sb.from('categories').select('*').order('sort')),
    async list({ cat, q, sort = 'featured', maxPrice, verifiedOnly, page = 0, per = 30 } = {}) {
      let r = sb.from('marketplace_listings').select('*', { count: 'exact' });
      if (cat && cat !== 'All') r = r.eq('category', cat);
      if (q) r = r.textSearch('title', q.trim().split(/\s+/).join(' & '), { type: 'plain', config: 'simple' });
      if (maxPrice) r = r.lte('current_price', maxPrice);
      if (verifiedOnly) r = r.eq('verified', true);
      if (sort === 'low') r = r.order('current_price');
      else if (sort === 'high') r = r.order('current_price', { ascending: false });
      else if (sort === 'top') r = r.order('sold', { ascending: false });
      else r = r.order('official', { ascending: false }).order('sold', { ascending: false });
      return ok(await r.range(page * per, page * per + per - 1));
    },
    one: async id => ok(await sb.from('marketplace_listings').select('*').eq('id', id).single()),
    vendor: async id => ok(await sb.from('vendors').select('id,store_name,username,bio,offers,official,verified,rating,sales_count,trust,created_at').eq('id', id).single()),
    reviews: async (vendorId) => ok(await sb.from('reviews').select('rating,body,created_at,product_id').eq('vendor_id', vendorId).order('created_at', { ascending: false }).limit(50)),
    wishToggle: async (productId, price) => {
      const s = await auth.session();
      const ex = ok(await sb.from('wishlist').select('product_id').eq('user_id', s.user.id).eq('product_id', productId));
      if (ex.length) { ok(await sb.from('wishlist').delete().eq('user_id', s.user.id).eq('product_id', productId)); return false; }
      ok(await sb.from('wishlist').insert({ user_id: s.user.id, product_id: productId, price_at_save: price })); return true;
    },
    report: async (kind, targetId, reason, details) => {
      const s = await auth.session();
      return ok(await sb.from('reports').insert({ reporter_id: s.user.id, kind, target_id: targetId, reason, details }));
    }
  };

  const buyer = {
    placeOrder: (productId, qty = 1, coupon = null) => rpc('place_order', { p_product: productId, p_qty: qty, p_coupon: coupon }),
    confirm: orderId => rpc('confirm_order', { p_order: orderId }),
    requestRefund: (orderId, reason) => rpc('request_refund', { p_order: orderId, p_reason: reason }),
    review: (orderId, rating, body) => rpc('submit_review', { p_order: orderId, p_rating: rating, p_body: body }),
    orders: async () => ok(await sb.from('orders').select('*, products(title,category,service,plan), order_deliveries(payload,kind)').order('created_at', { ascending: false })),
    subscriptions: async () => ok(await sb.from('subscriptions').select('*, products(title,category)').order('ends_at')),
    wallet: async () => {
      const s = await auth.session();
      const w = ok(await sb.from('wallets').select('*').eq('user_id', s.user.id).single());
      const tx = ok(await sb.from('wallet_transactions').select('*').eq('user_id', s.user.id).order('created_at', { ascending: false }).limit(50));
      return { ...w, tx };
    }
  };

  const vendor = {
    products: async () => ok(await sb.from('products').select('*').order('created_at', { ascending: false })),
    createProduct: async p => { const s = await auth.session(); return ok(await sb.from('products').insert({ ...p, vendor_id: s.user.id, status: p.status || 'pending' }).select().single()); },
    updateProduct: async (id, patch) => ok(await sb.from('products').update(patch).eq('id', id).select().single()),
    setStatus: (id, status) => vendor.updateProduct(id, { status }),
    addToPool: async (productId, rows) => {          // rows: [{email,password}|{code}|{link}]
      const s = await auth.session();
      return ok(await sb.from('account_pool').insert(rows.map(payload => ({ product_id: productId, vendor_id: s.user.id, payload }))));
    },
    orders: async () => ok(await sb.from('orders').select('*, products(title), profiles!orders_buyer_id_fkey(full_name)').order('created_at', { ascending: false })),
    markDelivered: (orderId, payload) => rpc('mark_delivered', { p_order: orderId, p_payload: payload ?? null }),
    approveRefund: (orderId, amount) => rpc('vendor_approve_refund', { p_order: orderId, p_amount: amount ?? null }),
    declineRefund: (orderId, reason) => rpc('vendor_decline_refund', { p_order: orderId, p_reason: reason }),
    addBank: async (bank_name, last4, account_name) => { const s = await auth.session(); return ok(await sb.from('bank_accounts').insert({ user_id: s.user.id, bank_name, last4, account_name })); },
    banks: async () => ok(await sb.from('bank_accounts').select('*')),
    withdraw: (amount, bankId) => rpc('request_withdrawal', { p_amount: amount, p_bank: bankId }),
    promote: (productId, placement, daily, days) => rpc('create_ad', { p_product: productId, p_placement: placement, p_daily: daily, p_days: days }),
    saveAutomation: async cfg => { const s = await auth.session(); return ok(await sb.from('vendors').update({ auto_config: cfg }).eq('id', s.user.id)); },
    coupons: async () => ok(await sb.from('coupons').select('*')),
    addCoupon: async c => { const s = await auth.session(); return ok(await sb.from('coupons').insert({ ...c, code: c.code.toUpperCase(), vendor_id: s.user.id })); },
    async submitKyc(kind, fullName, idNumber, files) {   // files: File[] -> private 'kyc' bucket
      const s = await auth.session(); const paths = [];
      for (const f of files) {
        const path = `${s.user.id}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, '_')}`;
        ok(await sb.storage.from('kyc').upload(path, f)); paths.push(path);
      }
      return ok(await sb.from('kyc_submissions').insert({ vendor_id: s.user.id, kind, full_name: fullName, id_number: idNumber, doc_paths: paths }));
    },
    async uploadListingImage(file) {
      const s = await auth.session(); const path = `${s.user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
      ok(await sb.storage.from('listing-images').upload(path, file));
      return sb.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
    }
  };

  const chat = {
    async openThread(vendorId, productId) {
      const s = await auth.session();
      const ex = ok(await sb.from('threads').select('*').eq('buyer_id', s.user.id).eq('vendor_id', vendorId).eq('product_id', productId));
      if (ex.length) return ex[0];
      return ok(await sb.from('threads').insert({ buyer_id: s.user.id, vendor_id: vendorId, product_id: productId }).select().single());
    },
    threads: async () => ok(await sb.from('threads').select('*, products(title), vendors(store_name), profiles!threads_buyer_id_fkey(full_name)').order('created_at', { ascending: false })),
    messages: async threadId => ok(await sb.from('messages').select('*').eq('thread_id', threadId).order('created_at')),
    send: async (threadId, body) => { const s = await auth.session(); return ok(await sb.from('messages').insert({ thread_id: threadId, sender_id: s.user.id, side: 'buyer', body }).select().single()); },
    subscribe(threadId, cb) {
      return sb.channel('thread-' + threadId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` }, p => cb(p.new))
        .subscribe();
    }
  };

  const disputes = {
    list: async () => ok(await sb.from('disputes').select('*, orders(order_no,total,buyer_id,vendor_id,products(title)), dispute_events(*)').order('created_at', { ascending: false })),
    note: (id, text) => rpc('add_dispute_note', { p_dispute: id, p_text: text })
  };

  const notifications = {
    list: async () => ok(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)),
    readAll: async () => ok(await sb.from('notifications').update({ read: true }).eq('read', false)),
    subscribe(userId, cb) {
      return sb.channel('notif-' + userId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, p => cb(p.new))
        .subscribe();
    }
  };

  const admin = {
    pendingListings: async () => ok(await sb.from('products').select('*, vendors(store_name)').eq('status', 'pending')),
    reviewListing: (id, approve, reason) => rpc('admin_review_listing', { p_product: id, p_approve: approve, p_reason: reason ?? null }),
    kycQueue: async () => ok(await sb.from('kyc_submissions').select('*, vendors(store_name)').eq('status', 'review')),
    kycFileUrl: async path => (ok(await sb.storage.from('kyc').createSignedUrl(path, 300))).signedUrl,
    reviewKyc: (id, approve, reason) => rpc('admin_review_kyc', { p_submission: id, p_approve: approve, p_reason: reason ?? null }),
    decideDispute: (id, decision, reason) => rpc('admin_decide_dispute', { p_dispute: id, p_decision: decision, p_reason: reason }),
    payWithdrawal: id => rpc('admin_pay_withdrawal', { p_id: id }),
    withdrawals: async () => ok(await sb.from('withdrawals').select('*, vendors(store_name)').order('created_at', { ascending: false })),
    suspend: (userId, flag, reason) => rpc('admin_set_suspension', { p_user: userId, p_suspended: flag, p_reason: reason ?? null }),
    reports: async () => ok(await sb.from('reports').select('*').eq('status', 'open')),
    flaggedChats: async () => ok(await sb.from('messages').select('*, threads(buyer_id,vendor_id)').eq('flagged', true).order('created_at', { ascending: false })),
    audit: async () => ok(await sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100)),
    setSetting: async (key, value) => ok(await sb.from('platform_settings').upsert({ key, value, updated_at: new Date().toISOString() }))
  };

  // Wallet top-up: open Paystack popup, the webhook (Edge Function) credits the wallet after payment is verified.
  // The balance on screen only changes once the webhook has written to the database - never trust the browser.
  async function fundWallet(amountNaira, paystackPublicKey) {
    const me = await auth.me();
    const ref = 'sub_' + crypto.randomUUID().replace(/-/g, '');
    return new Promise((resolve, reject) => {
      const h = window.PaystackPop.setup({
        key: paystackPublicKey, email: me.user.email, amount: Math.round(amountNaira * 100), currency: 'NGN', ref,
        metadata: { user_id: me.user.id },
        callback: () => resolve(ref), onClose: () => reject(new Error('Payment window closed'))
      });
      h.openIframe();
    });
  }

  window.Subora = { sb, auth, market, buyer, vendor, chat, disputes, notifications, admin, fundWallet };
})();
