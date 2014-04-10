(function(root, factory) {

    // Set up Swarm appropriately for the environment.

    // Start with AMD.
    if (typeof define === 'function' && define.amd) {

        define(['murmur', 'exports'], function(murmur, exports) {
            // Export global even in AMD case in case this script is loaded with others that may still expect a global Backbone.
            root.Swarm = factory(root, murmur, exports);
        });

    // Next for Node.js or CommonJS.
    } else if (typeof exports !== 'undefined') {

        var murmur = require('./murmur.js');
        factory(root, murmur, exports);

    // Finally, as a browser global.
    } else {

        root.Swarm = factory(root, root.murmur, {});
    }

} (this, function(root, murmur, Swarm) {

    //  S P E C I F I E R
    //
    //  The Swarm aims to switch fully from the classic HTTP
    //  request-response client-server interaction pattern to continuous
    //  real-time synchronization (WebSocket), possibly involving
    //  client-to-client interaction (WebRTC) and client-side storage
    //  (WebStorage). That demands (a) unification of transfer and storage
    //  where possible and (b) transferring, processing and storing of
    //  fine-grained changes.
    //
    //  That's why we use compound event identifiers named *specifiers*
    //  instead of just regular "plain" object ids everyone is so used to.
    //  Our ids have to fully describe the context of every small change as
    //  it is likely to be delivered, processed and stored separately from
    //  the rest of the related state.  For every atomic operation, be it a
    //  field mutation or a method invocation, a specifier contains its
    //  class, object id, a method name and, most importantly, its
    //  version id.
    //
    //  A serialized specifier is a sequence of Base64 tokens each prefixed
    //  with a "quant". A quant for a class name is '/', an object id is
    //  prefixed with '#', a method with '.' and a version id with '!'.  A
    //  special quant '+' separates parts of each token.  For example, a
    //  typical version id looks like "!7AMTc+gritzko" which corresponds to
    //  a version created on Tue Oct 22 2013 08:05:59 GMT by @gritzko (see
    //  Host.version()).
    //
    //  A full serialized specifier looks like
    //        /TodoItem#7AM0f+gritzko.done!7AMTc+gritzko
    //  (a todo item created by @gritzko was marked 'done' by himself)
    //
    //  Specifiers are stored in strings, but we use a lightweight wrapper
    //  class Spec to parse them easily. A wrapper is immutable as we pass
    //  specifiers around a lot.
    function Spec (str,quant) {
        if (str && str.constructor===Spec) {
            str=str.value;
        } else { // later we assume value has valid format
            str = (str||'').toString();
            if (quant && str.charAt(0)>='0')
                str = quant + str;
            if (str.replace(Spec.reQTokExt,''))
                throw new Error('malformed specifier: '+str);
        }
        this.value = str;
        this.index = 0;
    }

    Swarm.Spec = Spec;

    Spec.prototype.filter = function (quants) {
        return new Spec(
            this.value.replace(Spec.reQTokExt,function (token,quant) {
                return quants.indexOf(quant)!==-1 ? token : '';
            })
        );
    };
    Spec.pattern = function (spec) {
        return spec.toString().replace(Spec.reQTokExt,'$1');
    };
    Spec.prototype.pattern = function () {
        return Spec.pattern(this.value);
    };
    Spec.prototype.token = function (quant) {
        var at = quant ? this.value.indexOf(quant,this.index) : this.index;
        if (at===-1) return undefined;
        Spec.reQTokExt.lastIndex = at;
        var m=Spec.reQTokExt.exec(this.value);
        this.index = Spec.reQTokExt.lastIndex;
        if (!m) return undefined;
        return { quant: m[1], body: m[2], bare: m[3], ext: m[4] };
    };
    Spec.prototype.get = function specGet (quant) {
        var i = this.value.indexOf(quant);
        if (i===-1) return '';
        Spec.reQTokExt.lastIndex = i;
        var m=Spec.reQTokExt.exec(this.value);
        return m&&m[2];
    };
    Spec.prototype.has = function specHas (quant) {
        return this.value.indexOf(quant)!==-1;
    };
    Spec.prototype.set = function specSet (spec,quant) {
        var ret = new Spec(spec,quant), m=[];
        Spec.reQTokExt.lastIndex = 0;
        while (m=Spec.reQTokExt.exec(this.value))
            ret.has(m[1]) || (ret=ret.add(m[0]));
        return ret.sort();
    };
    Spec.prototype.version = function () { return this.get('!') };
    Spec.prototype.method = function () { return this.get('.') };
    Spec.prototype.type = function () { return this.get('/') };
    Spec.prototype.id = function () { return this.get('#') };
    Spec.prototype.source = function () { return this.token('!').ext };

    Spec.prototype.sort = function () {
        function Q (a, b) {
            var qa = a.charAt(0), qb = b.charAt(0), q = Spec.quants;
            return (q.indexOf(qa) - q.indexOf(qb)) || (a<b);
        }
        var split = this.value.match(Spec.reQTokExt);
        return new Spec(split?split.sort(Q).join(''):'');
    };
    /** mutates */
    Spec.prototype.add = function (spec,quant) {
        if (spec.constructor!==Spec)
            spec = new Spec(spec,quant);
        return new Spec(this.value+spec.value);
    };
    Spec.prototype.toString = function () { return this.value };


    Spec.int2base = function (i,padlen) {
        var ret = '', togo=padlen||5;
        for (; i||(togo>0); i>>=6, togo--)
            ret = Spec.base64.charAt(i&63) + ret;
        return ret;
    };

    Spec.base2int = function (base) {
        var ret = 0, l = base.match(Spec.re64l);
        for (var shift=0; l.length; shift+=6)
            ret += Spec.base64.indexOf(l.pop()) << shift;
        return ret;
    };
    Spec.parseToken = function (token_body) {
        Spec.reTokExt.lastIndex = -1;
        var m = Spec.reTokExt.exec(token_body);
        if (!m) return null;

        return { bare: m[1], ext: m[2] || 'swarm' };
    };

    Spec.base64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~';
    Spec.rT = '[0-9A-Za-z_~]+';
    Spec.re64l = new RegExp('[0-9A-Za-z_~]','g');
    Spec.quants = ['/','#','!','.'];
    Spec.reTokExt = new RegExp('^(=)(?:\\+(=))?$'.replace(/=/g,Spec.rT));
    Spec.reQTokExt = new RegExp('([/#\\.!\\*])((=)(?:\\+(=))?)'.replace(/=/g,Spec.rT),'g');
    Spec.is = function (str) {
        if (str===null || str===undefined) return false;
        return str.constructor===Spec || ''===str.toString().replace(Spec.reQTokExt,'');
    };
    Spec.as = function (spec) {
        if (!spec) {
            return new Spec('');
        } else {
            return spec.constructor === Spec ? spec : new Spec(spec);
        }
    };

    Spec.Map = function VersionVectorAsAMap (vec) {
        this.map = {};
        vec && this.add(vec);
    };
    Spec.Map.prototype.add = function (versionVector) {
        var vec=new Spec(versionVector,'!'), tok;
        while (tok=vec.token('!')) {
            var time = tok.bare, source = tok.ext||'swarm';
            if (time > (this.map[source]||''))
                this.map[source] = time;
        }
    };
    Spec.Map.prototype.covers = function (version) {
        Spec.reQTokExt.lastIndex = 0;
        var m = Spec.reTokExt.exec(version);
        var ts = m[1], src = m[2] || 'swarm';
        return ts <= (this.map[src]||'');
    };
    Spec.Map.prototype.maxTs = function () {
        var ts = null,
            map = this.map;
        for(var src in map) {
            if (!ts || ts < map[src]) {
                ts = map[src];
            }
        }
        return ts;
    };
    Spec.Map.prototype.toString = function (trim) {
        trim = trim || {top:10,rot:'0'};
        var top = trim.top || 10, rot = '!' + (trim.rot||'0');
        var ret = [], map = this.map;
        for(var src in map) {
            ret.push('!'+map[src]+(src==='swarm'?'':'+'+src));
        }
        ret.sort().reverse();
        while (ret.length>top || ret[ret.length-1]<=rot)
            ret.pop();
        return ret.join('')||'!0';
    };

    /** Syncable: an oplog-synchronized object */
    var Syncable = Swarm.Syncable = function Syncable () {
        // listeners represented as objects that have deliver() method
        this._lstn = [','];
        // The most correct way to specify a version is the version vector,
        // but that one may consume more space than the data itself in some cases.
        // Hence, _version is not a fully specified version vector (see version()
        // instead). _veersion is essentially is the greatest operation timestamp
        // (Lamport-like, i.e. "time+source"), sometimes amended with additional
        // timestamps. Its main features:
        // (1) changes once the object's state changes
        // (2) does it monotonically (in the alphanum order sense)
        this._version = '';
        // make sense of arguments
        var args = Array.prototype.slice.call(arguments), fresh;
        this._host = (args.length && args[args.length-1].constructor===Host) ?
            args.pop() : Swarm.localhost;
        if (Spec.is(args[0])) {
            this._id = new Spec(args.shift()).id();
        }else if (typeof(args[0])==='string') {
            this._id = args.shift(); // TODO format
        }
        this._id || (fresh=this._id=this._host.version());
        var state = args.length ? args.pop() : (fresh?{}:undefined);
        // register with the host
        var doubl = this._host.register(this);
        if (doubl!==this) return doubl;
        // fresh objects get state immediately (others query sources)
        fresh && state && this.__init
            (this.spec().add('!'+this._id+'.init'),state,this._host);
        // connect to the sync tree
        this.checkUplink();
        return this;
    };

    Syncable.types = {};
    Syncable.isOpSink = function (obj) {
        if (!obj) return false;
        if (obj.constructor===Function) return true;
        if (obj.deliver && obj.deliver.constructor===Function) return true;
        return false;
    };
    Syncable.popSink = function (args) {
    };
    Syncable.reMethodName = /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/;
    Syncable._default = {};
    var noop = function() { /* noop */ };


    /**  All state-changing methods of a syncable class must be...
      *  $$operation
      *  $_no-emit-operation
      *  _$rpcCall
      *  __sig3Method
      *  plainMethod()
      */
    Syncable.extend = function(fn,own) {
        var parent = this;
        if (fn.constructor!==Function) {
            var id = fn.toString();
            fn = function SomeSyncable(){
                // TODO reverse init order
                for(var name in fn.defaults) {
                    var dv = fn.defaults[name];
                    this[name] = dv.constructor===Object ? new dv.type(dv.value) : dv;
                }
                return parent.apply(this, arguments);
            };
            fn.id = fn.name = id; // if only it worked
        } else // please call Syncable.constructor.apply(this,args) in the constructor
            fn.id = fn.name;
        // inheritance trick from backbone.js
        var Surrogate = function(){ this.constructor = fn; };
        Surrogate.prototype = parent.prototype;
        var fnproto = fn.prototype = new Surrogate;
        // default field values
        var defs = fn.defaults = own.defaults || {};
        for(var k in defs) {
            if (defs[k].constructor===Function) {
                defs[k] = {type:defs[k]};
            }
        }

        // signature normalization for logged/remote/local method calls;
        function wrapCall (name, target) {
            return function wrapper () {
                // assign a Lamport timestamp
                var spec = this.newEventSpec(name);
                var args = Array.prototype.slice.apply(arguments), lstn;
                // find the callback if any
                Syncable.isOpSink(args[args.length-1]) && (lstn = args.pop());
                // prettify the rest of the arguments
                if (!args.length) {
                    args = ''; // used as 'empty'
                } else if (args.length===1) {
                    args = args[0]; // {key:val}
                }
                // TODO log 'initiated'
                // deliver
                this[target](spec,args,lstn);
            };
        };

        // "Methods" are serialized, logged and delivered to replicas
        for (var name in own.methods||{}) {
            if (!Syncable.reMethodName.test(name)) continue;
            fnproto['$$'+name] = own.methods[name];
            fnproto[name] = wrapCall(name,'deliver');
        }

        // "Neutrals" don't change the state
        for (var name in own.neutrals||{}) {
            if (!Syncable.reMethodName.test(name)) continue;
            fnproto['__'+name] = own.neutrals[name];
            fnproto[name] = wrapCall(name,'deliver');
        }

        // "Remotes" are serialized and sent upstream (like RPC calls)
        for (var name in own.remotes||{}) {
            if (!Syncable.reMethodName.test(name)) continue;
            fnproto[name] = wrapCall(name,'remote');
        }

        for (var name in own) {
            if (!Syncable.reMethodName.test(name)) continue;
            own[name].constructor===Function && (fnproto[name] = own[name]);
        }

        // finishing touches
        fnproto._super = parent.prototype;
        fn._super = parent;
        fnproto._type = fn.id;
        fnproto._reactions = {};
        fn._pt = fnproto; // just a shortcut
        fn.extend = this.extend;
        fn.addReaction = this.addReaction;
        fn.removeReaction = this.removeReaction;
        Syncable.types[fn.id] = fn;
        return fn;
    };

    // A *reaction* is a hybrid of a listener and a method. It "reacts" on a
    // certain event for all objects of that type. The callback gets invoked
    // as a method, i.e. this===syncableObj. In an event-oriented architecture
    // reactions are rather handy, e.g. for creating mixins.
    Syncable.addReaction = function (method,fn) {
        var reactions = this.prototype._reactions;
        var list = reactions[method];
        if (!list)
            list = reactions[method] = [];
        list.push(fn);
        return {method:method,fn:fn};
    };

    Syncable.removeReaction = function (handle) {
        var method=handle.method, fn=handle.fn;
        var list = this.prototype._reactions[method];
        var i = list.indexOf(fn);
        if (i===-1) throw new Error('reaction unknown');
        list[i] = undefined; // such a peculiar pattern not to mess up out-of-callback removal
        while (list.length && !list[list.length-1]) list.pop();
    };


    // Syncable includes all the (replica) spanning tree and (distributed)
    // garbage collection logix.
    Syncable.extend(Syncable,{  // :P
        spec: function () { return new Spec('/'+this._type+'#'+this._id); },

        newEventSpec: function (eventName) { 
            return this.spec().add(this._host.version(),'!').add(eventName,'.');
        },

        // applies a serialized operation (or a batch thereof) to this replica
        deliver: function (spec,value,lstn) {
            spec = Spec.as(spec);
            var opver = spec.version(), logCall=false;

            function fail (msg,ex) {
                console.error(msg,spec,value,ex||new Error(msg));
                if (typeof(lstn)==='function') {
                    lstn(spec.set('.fail'),msg);
                } else if (lstn && typeof(lstn.error)==='function') {
                    lstn.error(spec,msg);
                } else { } // no callback provided
            }
            
            // sanity checks
            if (spec.pattern()!=='/#!.') {
                return fail ('malformed spec',spec);
            } else if (!this._id) {
                return fail('undead object invoked');
            } else if (!this.validate(spec,value)) {
                return fail('invalid input',value);
            } else if (!this.acl(spec,value,lstn)) {
                return fail('access violation',spec);
            }
            
            if (opver<this._version && this.isReplay(spec)) return; // it happens

            Swarm.debug && this.log(spec,value,lstn);
            
            try{
                var call = spec.method();
                if (typeof(this['$$'+call])==='function') {
                    logCall = true;
                    this['$$'+call](spec,value,lstn); // NOTE: no return value
                } else if (typeof(this['__'+call])==='function') {
                    this['__'+call](spec,value,lstn); // NOTE: no return value
                } else {
                    this.unimplemented(spec,value,lstn);
                }
            } catch(ex) { // log and rethrow; don't relay further; don't log
                return fail("method execution failed",ex);
            }

            if (logCall) { // otherwise replicas will get on()s
                this.emit(spec,value,lstn);
                if (this._oplog) { // remember in the log
                    this._oplog[spec.filter('!.')] = value;
                    this.compactLog && this.compactLog(); // TODO optimize
                }
                this._version = (opver > this._version) ? opver : this._version + '!' + opver;
            }

            // to force async signatures we eat the returned value silently
            return spec;
        },

        // notify all the listeners of an operation
        emit: function (spec,value,source) {
            var ls = this._lstn;
            if (ls && ls.length) {
                //this._lstn = []; // cycle protection
                for (var i = 0; i < ls.length; i++) {
                    if (ls[i] && ls[i] !== source && ls[i]!==',') {
                        try {// skip empties, deferreds and the source
                            ls[i].deliver(spec, value, this);
                        } catch (ex) {
                            console.error(ex.message, ex.stack);
                        }
                    }
                }
            }
            var r = this._reactions[spec.method()];
            if (r) {
                r.constructor!==Array && (r = [r]);
                for(i = 0; i < r.length; i++) {
                    r[i] && r[i].call(this,spec,value,source);
                }
            }
            //if (this._lstn.length)
            //    throw new Error('Speedy Gonzales at last');
            //this._lstn = ls; // cycle protection off
        },

        trigger: function (event, params) {
            var spec = this.newEventSpec(event);
            this.deliver(spec,params);
        },

        // Blindly applies a JSON changeset to this model.
        apply: function (values) {
            for(var key in values) {
                //if (Model.reFieldName.test(key) && typeof(this[key])!=='function'){
                // FIXME validate()
                    var def = this.constructor.defaults[key];
                    this[key] = def&&def.type ? new def.type(values[key]) : values[key];
            }
        },
        validateOrder: function (spec,val,src) {
            /*var source = Spec.ext(version);
            for(var opspec in this._oplog)
                if (opspec.indexOf(source)!==-1) {
                    var v=new Spec(opspec).version(), s=Spec.ext(v);
                    if (s===source && version<=v)
                        return; // replay!
                 }*/
        },
        // the version vector for this object
        version: function () {
            var map = new Spec.Map(this._version);
            if (this._oplog) {
                for(var op in this._oplog) {
                    map.add(op);
                }
            }
            return map.toString(); // TODO return the object, let the consumer trim it to taste
        },

        // Produce the entire state or probably the necessary difference
        // to synchronize a replica which is at version *base*.
        diff: function (base) {
        },
        // whether the update source (author) has the rights necessary
        acl: function (spec,val,src) {
            return true;
        },
        // update validity (data format, etc)
        validate: function (spec,val,src) {
            return true;
        },
        // whether this op was already applied in the past
        isReplay: function (spec) {
            return spec.filter('!.') in this._oplog; // TODO log trimming, vvectors?
        },
        hasState: function() {
            return !!this._version;
        },
        
        neutrals: {
            // Subscribe to the object's operations;
            // the upstream part of the two-way subscription
            //  on() with a full filter:
            //    /Mouse#Mickey!now.on   !since.event   callback
            on: function (spec,filter,repl) {   // WELL  on() is not an op, right?
                // if no listener is supplied then the object is only
                // guaranteed to exist till the next Swarm.gc() run
                if (!repl) return;

                // stateless object fire no events; essentially, on() is deferred
                if (!this._version) {
                    this._lstn.push( {
                        $pendingdl$: [spec,filter,repl],
                        deliver: function () {}
                    }); // defer this call (see __reon)
                    return;
                }

                if (repl.constructor===Function) {
                    repl = {
                        sink: repl,
                        that: this,
                        deliver: function () {
                            this.sink.apply(this.that,arguments);
                        }
                    };
                }

                filter = new Spec(filter||'','.');
                var base = filter.get('!'),
                    event = filter.get('.');

                if (event==='init') {
                    repl.deliver(spec.set('.init'),this.pojo(),this);
                    return;
                }
                if (event) {
                    repl = {
                        sink: repl,
                        deliver: function (spec,val,lstn) {
                            spec.method()===event && this.sink.deliver(spec,val,lstn);
                        }
                    };
                }

                if (base) {
                    var diff = this.diff('!'+base);
                    diff && repl.deliver(spec.set('.bundle'), diff, this);
                    repl.deliver (spec.set('.reon'), this.version(), this);
                }
                
                this._lstn.push(repl);
                // TODO repeated subscriptions: send a diff, otherwise ignore
            },

            bundle: function (spec,value,lstn) {
                var specs = [], typeid=spec.filter('/#');
                for (var sp in value) Spec.pattern(sp)==='!.' && specs.push(sp);
                specs.sort().reverse();
                while (sp = specs.pop()) this.deliver(typeid+sp,value[sp],lstn);
                return sp;
            },

            // downstream reciprocal subscription
            reon: function (spec,base,repl) {
                if (!repl) throw new Error('whom?');
                var ls=this._lstn, deferreds = [], dfrd, diff;
                
                for(var i=0; i<ls.length&&ls[i]!==','; i++) {
                    if (ls[i] && ls[i].$pending_ul$===repl) break;
                    if (repl._host && ls[i] && ls[i].$pending_ul$===repl._host) break; // direct
                }

                if (ls[i]===',') {
                    repl.deliver(spec.set('.error'),'source unknown',this);
                    return;
                }

                ls[i] = repl; 

                if (base && (diff=this.diff(base))) {
                    repl.deliver(spec.set('.bundle'),diff,this);
                }

            },

            // Unsubscribe
            off: function (spec,val,repl) {
                var ls = this._lstn;
                var i = ls.indexOf(repl); // fast path
                if (i===-1) {
                    for(i = 0; i < ls.length; i++) {
                        var l = ls[i];
                        if (l && l._wrapper && l.deliver===repl.deliver) { break; }
                        if (l && l.constructor===Array && l[2]===repl) { break; }
                    }
                }
                if (i < ls.length) {
                    ls[i] = undefined;
                } else {
                    console.warn('listener', repl._id, 'is unknown to', this._id);
                }
                while (ls.length > 1 && !ls[ls.length - 1]) ls.pop();
            },
            reoff: function (spec,val,repl) {
                if (this._lstn[0] === repl) {
                    this._lstn[0] = undefined; // may be shifted
                    if (this._id) { this.checkUplink(); }
                }
                //TODO don't need to throw new Error('reoff: uplink mismatch');
            },

            // As all the event/operation processing is asynchronous, we
            // cannot simply throw/catch exceptions over the network.
            // This method allows to send errors back asynchronously.
            // Sort of an asynchronous complaint mailbox :)
            error: function (spec,val,repl) {
                console.error('something failed: '+spec+' at '+repl._id);
            },

            init: function (spec) {
                if (this._version && this._version!=='0')
                    console.warn('TODO: reinit if short of log');
                this._version = spec.version();
                // do deferred diff responses and reciprocal subscriptions
                var ls = this._lstn, pending = [], args;
                this._lstn = this._lstn.filter(function(ln){
                    return !(ln && ln.$pendingdl$ && pending.push(ln.$pendingdl$));
                });
                while (args = pending.pop())
                    this.__on.apply(this,args);
            }
        }, // neutrals

        // Uplink connections may be closed or reestablished so we need
        // to adjust every object's subscriptions time to time.
        checkUplink: function () {
            var uplinks = this._host.getSources(this.spec()).slice();
            // the plan is to eliminate extra subscriptions and to
            // establish missing ones; that only affects outbound subs
            for(var i=0; i<this._lstn.length && this._lstn[i]!=','; i++) {
                var up = this._lstn[i];
                up.$pending_ul$ && (up = up.$pending_ul$);
                var ui=uplinks.indexOf(up);
                if (ui===-1) { // don't need this uplink anymore
                    up.deliver(this.newEventSpec('off'),'',this);
                } else {
                    uplinks[i] = undefined;
                }
            }
            for(var i=0; i<uplinks.length; i++) { // subscribe to the new
                if (uplinks[i]===undefined) continue;
                var ln = uplinks[i];
                this._lstn.unshift({
                    $pending_ul$: ln,
                    deliver: noop
                });
                ln.deliver(this.newEventSpec('on'),this.version(),this);
            }
        },
        // Sometimes we get an operation we don't support; not normally
        // happens for a regular replica, but still needs to be caught
        unimplemented: function (spec,val,repl) {
            console.warn("method not implemented:",spec);
        },
        // Deallocate everything, free all resources.
        close: function () {
            var l=this._lstn, s=this.spec();
            var uplink = l.shift();
            this._id = null; // no id - no object; prevent relinking
            uplink && uplink.off(s,null,this);
            while (l.length)
                l.pop().reoff(s,null,this);
            this._host.unregister(this);
        },
        // Once an object is not listened by anyone it is perfectly safe
        // to garbage collect it.
        gc: function () {
            var l = this._lstn;
            if (!l.length || (l.length===1 && !l[0]))
                this.close();
        },
        log: function(spec,value,replica) {
            var myspec = this.spec().toString(); //:(
            console.log(
                "%c@%s  %c%s%c%s  %c%O  %c%s@%c%s",
                "color: #888",
                    this._host._id,
                "color: #246",
                    this.spec().toString(),
                "color: #024; font-style: italic",
                    (myspec==spec.filter('/#')?
                        spec.filter('!.').toString() :
                        ' <> '+spec.toString()),
                "font-style: normal; color: #042",
                    (value&&value.constructor===Spec?value.toString():value),
                "color: #88a",
                    (replica&&((replica.spec&&replica.spec().toString())||replica._id)) ||
                        (replica?'no id':'undef'),
                "color: #ccd",
                        replica&&replica._host&&replica._host._id
                    //replica&&replica.spec&&(replica.spec()+
                    //    (this._host===replica._host?'':' @'+replica._host._id)
            );
        },
        once: function (filter,fn) { // only takes functions; syncables don't need 'once'
            this.on(filter, function onceWrap() {
                fn.apply(this,arguments); // "this" is the object
                this.off(filter,onceWrap);
            });
        }
    });


    var Model = Swarm.Model = Syncable.extend('Model',{
        defaults: {
            _oplog: Object
        },
        /**  init modes:
        *    1  fresh id, fresh object
        *    2  known id, stateless object
        *    3  known id, state boot
        */
        neutrals: {
            on: function (spec,base,repl) {
                //  support the model.on('field',callback_fn) pattern
                if (typeof(repl)==='function' && 
                        typeof(base)==='string' &&
                        (base in this.constructor.defaults)) {
                    var stub = {
                        fn: repl,
                        key: base,
                        self: this,
                        deliver: function (spec,val,src) {
                            if (spec.method()==='set' && (this.key in val)) {
                                this.fn.call(this.self,spec,val,src);
                            }
                        }
                    };
                    repl = stub;
                    base = '';
                }
                // this will delay response if we have no state yet
                Syncable._pt.__on.call(this,spec,base,repl);
            },

            off: function (spec,base,repl) {
                var ls = this._lstn;
                if (typeof(repl)==='function') {
                    for(var i=0;i<ls.length;i++) {
                        if (ls[i].fn===repl && ls[i].key===base) {
                            repl = ls[i];
                            break;
                        }
                    }
                }
                Syncable.prototype.__off.apply(this,arguments);
            },

            init: function (spec,snapshot,host) {
                if (this._version && this._version!=='0')
                    return; // FIXME tail FIXME
                snapshot && this.apply(snapshot);
                Syncable._pt.__init.apply(this,arguments);
            }
        },

        diff: function (base) {
            var spec,
                ret = null;
            if (base && base!='!0') { // diff sync
                var map = new Spec.Map(base); // FIXME ! and bare
                for(spec in this._oplog) {
                    if (!map.covers(new Spec(spec).version())) {
                        ret || (ret = {});
                        ret[spec] = this._oplog[spec];
                    }
                }
                // TODO log truncation, forced init and everything
            } else { // snapshot sync
                if (this._version) {
                    ret = {};
                    var key = '!'+this._version+'.init';
                    ret[key] = this.pojo();
                    ret[key]._oplog = {};
                    ret[key]._version = this._version;
                    for(spec in this._oplog) {
                        ret[key]._oplog[spec] = this._oplog[spec];
                    }
                    this.packState(ret);
                }
            }
            return ret;
        },

        // TODO remove unnecessary value duplication
        packState: function (state) {
        },
        unpackState: function (state) {
        },
        /** Removes redundant information from the log; as we carry a copy
         *  of the log in every replica we do everythin to obtain the minimal
         *  necessary subset of it.
         *  As a side effect, distillLog allows up to handle some partial
         *  order issues (see $$set). */
        distillLog: function () {
            // explain
            var sets = [], cumul = {}, heads = {}, spec;
            for(var s in this._oplog) {
                spec = new Spec(s);
                if (spec.method() === 'set') {
                    sets.push(spec);
                }
            }
            sets.sort();
            for(var i=sets.length-1; i>=0; i--) {
                spec = sets[i];
                var val = this._oplog[spec], notempty = false;
                for(var key in val) {
                    if (key in cumul) {
                        delete val[key];
                    } else {
                        notempty = cumul[key] = true;
                    }
                }
                var source = spec.source();
                notempty || (heads[source] && delete this._oplog[spec]);
                heads[source] = true;
            }
            return cumul;
        },

        methods: {
            /** This barebones Model class implements just one kind of an op:
             *  set({key:value}). To implment your own ops you need to understand
             *  implications of partial order as ops may be applied in slightly
             *  different orders at different replicas. This implementation
             *  may resort to distillLog() to linearize ops.
             * */
            set: function (spec,value,repl) {
                var version = spec.version(), vermet = spec.filter('!.').toString();
                if (vermet in this._oplog) // ^^^ FIXME in Syncable
                    return; // replay
                this._oplog[vermet] = value._id ? value._id : value; // TODO nicer (sigwrap)  FIXME POJO
                version<this._version && this.distillLog(); // may amend the value
                var distilled = this._oplog[vermet];
                distilled && this.apply(distilled);
            }
        },
        pojo: function () {
            var pojo = {}, defs = this.constructor.defaults;
            for(var key in this) if (this.hasOwnProperty(key)) {
                if (Model.reFieldName.test(key)) {
                    var def = defs[key], val = this[key];
                    pojo[key] = def&&def.type ? (val.toJSON&&val.toJSON()) || val.toString() :
                                (val&&val._id ? val._id : val) ; // TODO prettify
                }
            }
            return pojo;
        },
        fill: function (key) { // TODO goes to Model to support references
            if (!this.hasOwnProperty(key))
                throw new Error('no such entry');
            //if (!Spec.is(this[key]))
            //    throw new Error('not a specifier');
            var spec = new Spec(this[key]).filter('/#');
            if (spec.pattern()!=='/#')
                throw new Error('incomplete spec');
            this[key] = this._host.get(spec);
            /* TODO new this.refType(id) || new Swarm.types[type](id);
            on('init', function(){
                self.emit('fill',key,this)
                self.emit('full',key,this)
            });*/
        },
        save: function () {
            var cumul = this.compactLog(), changes = {}, pojo=this.pojo(), key;
            for(key in pojo) {
                if (this[key]!==cumul[key]) {// TODO nesteds
                    changes[key] = this[key];
                }
            }
            for(key in cumul) {
                if (!(key in pojo)) {
                    changes[key] = null; // JSON has no undefined
                }
            }
            this.set(changes);
        }
    });
    Model.reFieldName = /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/;

    // Model may have reactions for field changes as well as for 'real' ops/events
    // (a field change is a .set operation accepting a {field:newValue} map)
    Model.addReaction = function (methodOrField, fn) {
        var proto = this.prototype;
        if (typeof(proto[methodOrField])==='function') { // it is a field name
            return Syncable.addReaction.call(this,methodOrField,fn);
        } else {
            var wrapper = function (spec,val) {
                if (methodOrField in val)
                    fn.apply(this,arguments);
            };
            wrapper._rwrap = true;
            return Syncable.addReaction.call(this,'set',wrapper);
        }
    };


    // Backbone's Collection is essentially an array and arrays behave poorly
    // under concurrent writes (see OT). Hence, our primary collection type
    // is a {key:Model} Set. One may obtain a linearized version by sorting
    // them by keys or otherwise.
    var Set = Swarm.Set = Model.extend('Set', {
        // an alias for $$set()
        add: function (key,spec) {
            var obj; // TODO add(obj)
            if (spec._id) {
                obj = spec;
                spec = obj.spec();
            }
            var kv = {};
            kv[key] = spec;
            var spec = this.set(kv); //FIXME unused
            obj && (this[key]=obj); // sorta auto-fill
            //method := 'add'
            //this._emit();
        },
        remove: function (key) {
            var kv = {};
            kv[key] = null;
            this.set(kv);  // FIXME key:val instead of {key:val} pidorasit
            //method := 'remove'
            //this._emit();
        },
        get: function (key) {
            // TODO default type
            if (!Spec.is(key) || !this[key])
                return undefined;
            if (!this[key]._id)
                this.fill(key);
            return this[key];
        },
        fillAll: function () {
            var keys = this.pojo();
            for(var key in keys) {
                if (this[key] && !this[key]._id) {
                    this.fill(key); // TODO events init->???
                }
            }
        },
        pojo: function () {
            var pojo = {}, defs = this.constructor.defaults;
            for(var key in this) {
                if (Spec.is(key)) {
                    var def = defs[key], val = this[key];
                    pojo[key] = def&&def.type ? (val.toJSON&&val.toJSON()) || val.toString() :
                            (val&&val._id ? val._id : val) ; // TODO prettify
                }
            }
            return pojo;
        },
        collection: function () {
            var keys = [], obj = [], pojo = this.pojo();
            for(var key in pojo) {
                keys.push(key);
            }
            keys.sort(); // TODO compare fn
            for(var i=0; i<keys.length; i++) {
                if (this[keys[i]]) {
                    obj.push(this[keys[i]]);
                }
            }
            return obj;
        }
    });

    /** Host is (normally) a singleton object registering/coordinating
     *  all the local Swarm objects, connecting them to appropriate
     *  external uplinks, maintaining clocks, etc.
     *  Host itself is not fully synchronized like a Model but still
     *  does some event gossiping with peer Hosts.
     *  */
    function Host (id, val, storage) {
        this.objects = {};
        this.lastTs = '';
        this.tsSeq = 0;
        this.clockOffset = 0;
        this.sources = {};
        this.storage = storage;
        this._host = this; // :)
        this._lstn = [','];
        this._id = id;

        if (this.storage) {
            this.sources[this._id] = this.storage;
            this.storage._host = this;
        }
        delete this.objects[this.spec()];
    }

    Swarm.Host = Syncable.extend(Host,{

        deliver: function (spec,val,repl) {
            if (spec.pattern()!=='/#!.')
                throw new Error('incomplete event spec');
            if (spec.type()!=='Host') {
                var typeid = spec.filter('/#');
                var obj = this.get(typeid);
                obj && obj.deliver(spec,val,repl);
            } else
                this._super.deliver.apply(this,arguments);
        },

        init: function (spec,val,repl) {

        },

        get: function (spec) {
            if (spec&&spec.constructor===Function&&spec.id)
                spec = '/'+spec.id;
            spec = new Spec(spec);
            var typeid = spec.filter('/#');
            if (!typeid.has('/'))
                throw new Error('invalid spec');
            var o = typeid.has('#') && this.objects[typeid];
            if (!o) {
                var t = Syncable.types[spec.type()];
                o = new t(typeid,undefined,this);
            }
            return o;
        },

        addSource: function hostAddPeer (spec,peer) {
            if (false) { // their time is off so tell them so  //FIXME ???
                this.clockOffset;
            }
            var old = this.sources[peer._id];
            old && old.deliver(this.newEventSpec('off'),'',this);

            this.sources[peer._id] = peer;
            if (spec.method()==='on')
                peer.deliver(this.newEventSpec('reon'),'',this); // TODO offset

            for(var sp in this.objects) {
                this.objects[sp].checkUplink();
            }

            this.emit(spec,'',peer); // PEX hook
        },

        neutrals: {
            // Host forwards on() calls to local objects to support some
            // shortcut notations, like
            //          host.on('/Mouse',callback)
            //          host.on('/Mouse.init',callback)
            //          host.on('/Mouse#Mickey',callback)
            //          host.on('/Mouse#Mickey.init',callback)
            //          host.on('/Mouse#Mickey!baseVersion',repl)
            //          host.on('/Mouse#Mickey!base.x',trackfn)
            // The target object may not exist beforehand.
            // Note that the specifier is actually the second 3sig parameter
            // (value). The 1st (spec) reflects this /Host.on invocation only.
            on: function hostOn (spec,evfilter,lstn) {
                if (!evfilter) // the subscriber needs "all the events"
                    return this.addSource(spec,lstn);

                if (evfilter.constructor===Function && evfilter.id) evfilter=evfilter.id;

                var objon = new Spec(evfilter,'/').filter('/#');
                if (!objon.has('/'))
                    throw new Error('no type mentioned');
                objon.has('#') || (objon=objon.add(spec.version(),'#'));
                objon=objon.add(spec.version(),'!').add('.on').sort();

                this.deliver(objon,evfilter,lstn);

                    // We don't do this as the object may have no state now.
                    // return o;
                    // Instead, use host.on('/Type#id.init', function(,,o) {})

            },

            reon: function hostReOn (spec,ts,host) {
                if (spec.type()!=='Host') throw 'think';
                /// well.... TODO
                this.addSource(spec,host);
            },

            off: function (spec,nothing,peer) {
                var obj;
                if (spec.type()!=='Host') { // host.off('/Type#id') shortcut
                    var typeid = spec.filter('/#');
                    obj = this.objects[typeid];
                    if (obj) {
                        obj.off(spec,clocks,peer);
                    }
                    return;
                }
                if (this.sources[peer._id]!==peer) {
                    //throw new Error
                    console.error('peer unknown', peer._id);
                    return;
                }
                if (this._id !== peer._id) { // skip if peer ~ storage
                    delete this.sources[peer._id];
                }
                for (var sp in this.objects) {
                    obj = this.objects[sp];
                    if (obj._lstn && obj._lstn.indexOf(peer)!==-1) {
                        obj.off(sp,'',peer);
                        this.checkUplink(sp);
                    }
                }
                if (spec.method()==='off') {
                    peer.deliver(this.newEventSpec('reoff'),'',this);
                }
            },

            reoff: function hostReOff (spec,ts,host) {
            }

        }, // neutrals

        // Returns an unique Lamport timestamp on every invocation.
        // Swarm employs 30bit integer Unix-like timestamps starting epoch at
        // 1 Jan 2010. Timestamps are encoded as 5-char base64 tokens; in case
        // several events are generated by the same process at the same second
        // then sequence number is added so a timestamp may be more than 5
        // chars. The id of the Host (+user~session) is appended to the ts.
        version: function () {
            var d = new Date().getTime() - Host.EPOCH + (this.clockOffset||0);
            var ts = Spec.int2base((d/1000)|0,5), seq='';
            if (ts===this.lastTs)
                seq = Spec.int2base(++this.tsSeq,2); // max ~4000Hz
            else
                this.tsSeq = 0;
            this.lastTs = ts;
            return ts + seq + '+' + this._id;
        },
        // returns an array of sources (caches,storages,uplinks,peers)
        // a given replica should be subscribed to.
        getSources: function (spec) {
            var ret = [this.storage]; // client-side impl
            if (this.uplinks && this.uplinks.length) {
            }
            return ret;
        },
        // Returns an array of available uplink peer ids according to the consistent
        // hashing scheme. Note that client-side code runs this logic as well:
        // it is perfectly OK for a client to connect to multiple edge servers.
        /*availableUplinks: function (spec) {
            var self=this,
                uplinks=[],
                threshold = 4294967295,
                is_serverside = /^swarm/.test(this._id),
                target = Swarm.hash(spec)

            if (is_serverside) {
                threshold = Swarm.hashDistance(this._id, target);
                if (self.storage) {
                    uplinks.push({id: this._id, distance: threshold});
                }
            }
            for(var id in this.sources) {
                if (!/^swarm/.test(id)) { continue; } //skip client connections (it can't be an uplink)

                var dist = Swarm.hashDistance(id, target); //Math.abs(hash(id)-target);
                if (dist <= threshold) {
                    uplinks.push({id: id, distance: dist});
                }
            }
            uplinks.sort(function(x,y){ return x.distance - y.distance });
            return uplinks.map(function(o){return self.peers[o.id]});
        },*/

        register: function (obj) {
            var spec = obj.spec();
            if (spec in this.objects)
                return this.objects[spec];
            this.objects[spec] = obj;
            return obj;
        },

        unregister: function (obj) {
            var spec = obj.spec();
            // TODO unsubscribe from the uplink - swarm-scale gc
            (spec in this.objects) && delete this.objects[spec];
        },

        // initiate 2-way subscription (normally to a remote host)
        connect: function (peer) {
            peer.deliver(this.newEventSpec('on'),'',this); // TODO offset
        },

        checkUplink: function (spec) {
            //  TBD Host event relay + PEX
        }
    });
    Host.MAX_INT = 9007199254740992;
    Host.EPOCH = 1262275200000; // 1 Jan 2010 (milliseconds)
    Host.MAX_SYNC_TIME = 60*60000; // 1 hour (milliseconds)
    Swarm.HASH_FN = murmur.hash3_32_gc; //TODO use 2-liner, add murmur in murmur.js

    Swarm.CHASH_POINT_COUNT = 3;

    Swarm.hash = function hash (str) {
        var ret = [];
        // TODO rolling cache
        for(var i=0; i<Swarm.CHASH_POINT_COUNT; i++)
            ret.push(Swarm.HASH_FN(str,i))
        return ret;
    };


    Swarm.hashDistance = function hashDistance (id1,id2) {
        var hash1 = id1.constructor===Array ? id1 : Swarm.hash(id1.toString());
        var hash2 = id2.constructor===Array ? id2 : Swarm.hash(id2.toString());
        var mindist = 4294967295;
        for(var i=0; i<Swarm.CHASH_POINT_COUNT; i++) {
            for(var j=i; j<Swarm.CHASH_POINT_COUNT; j++) {
                mindist = Math.min( mindist, Math.abs(hash1[i]-hash2[j]) );
            }
        }
        return mindist;
    };

    Swarm.STUB = {
        deliver:function(){},
        on:function(){},
        off:function(){}
    };

    /**
     * Mocks a Host except all calls are serialized and sent
     * to the sink; any arriving data is parsed and delivered
     * to the local host.
     */
    function Pipe (opts) {
        var self = this;
        self.opts = opts || {};
        if (!self.opts.host) {
            throw new Error('no host specified for pipe');
        }
        if (!self.opts.transport && !self.opts.sink) {
            throw new Error('either "transport" or "sink" should be specified for pipe');
        }

        self.host = self._host = opts.host;
        self.transport = opts.transport;
        self.sink = opts.sink;
        self.serializer = opts.serializer || JSON;

        self._id = null;
        self.katimer = null;
        self.lastSendTS = self.lastRecvTS = self.time();
        self.bundle = {};
        self.timeout = self.opts.timeout || -1;
        self.reconnectDelay = self.opts.reconnectDelay || 1000;
    }
    Swarm.Pipe = Pipe;

    Pipe.KEEPALIVE_PERIOD = 8000; //ms
    Pipe.KEEPALIVE_PERIOD_HALF = Pipe.KEEPALIVE_PERIOD >> 1;
    Pipe.UNHERD = 20; // 20ms, thundering herd avoidance

    Pipe.prototype.startKeepAlive = function () {
        if (this.katimer) { return; }
        //console.log('pipe.startKeepAlive');
        var ka_interval = Pipe.KEEPALIVE_PERIOD_HALF + (10 * Math.random()) | 0;
        this.katimer = setInterval(this.keepalive.bind(this), ka_interval); // desynchronize
    };

    Pipe.prototype.stopKeepAlive = function () {
        if (!this.katimer) { return; }
        //console.log('pipe.stopKeepAlive');
        clearInterval(this.katimer);
        this.katimer = null;
    };

    Pipe.prototype.connect = function pc () {
        var self = this;
        var logger = self.console || console;

        if (!self.sink) {
            self.sink = self.transport();
            self.sink.on('open', function onConnectionOpened() {
                if (Swarm.debug) { logger.log('sink opened'); }
                self.host.connect(self); // BAD: mixing active/passive behavior in the Pipe class
                self.startKeepAlive();
            });
        } else {
            self.startKeepAlive();
        }

        self.sink.on('data', function onMessageReceived(message_data) {
            console.log(self.host._id,'received from',self._id,message_data);
            self.lastRecvTS = self.time();
            var str = message_data.toString();
            if (self._id)
                self.parseBundle(str);
            else
                self.parseHandshake(str);
            self.reconnectDelay = self.opts.reconnectDelay || 1000;
        });
        //TODO ??? handle "error"
        self.sink.on('close', function onConnectionClosed(reason) {
            if (Swarm.debug) { logger.log('sink closed'); }
            self.sink = null; // needs no further attention
            self.stopKeepAlive();
            //TODO ??? unregister all listeners
            self._id && self.close(true); // are we closing for internal/external reasons?
        });
    };

    Pipe.prototype.parseHandshake = function ph (str) {
        var handshake = this.serializer.parse(str), spec, value, key;
        for (key in handshake) {
            spec = new Spec(key);
            value = handshake[key];
            break; // 8)-
        }
        if (!spec) { throw new Error('handshake:no_spec'); }
        this._id = spec.id();
        if (this.console && this.console.grep) { this.console.grep(' ' + this._id); }

        var method = spec.method();
        switch (method) {
        case 'on':
            this.host.__on(spec, value, this); break;
        case 'reon':
            this.host.__reon(spec, value, this); break;
        default:
            throw new Error('handshake:wrong_method');
        }
    };

    Pipe.prototype.close = function pc (reconnect) {
        if (Swarm.debug) { (this.console || console).log('pipe.close'); }
        this.stopKeepAlive();
        this.host.off(this);
        this._id = null;
        if (this.sink) try {
            this.sink.close();
            this.sink = null;
        } catch(ex){}

        if (reconnect) {
            var self = this;
            // schedule a retry
            self.reconnectDelay = Math.min(30000, self.reconnectDelay<<1);
            if (self.transport) {
                setTimeout(function () { self.connect(); }, self.reconnectDelay);
            }
        }
    };

    Pipe.prototype.deliver = function pd (spec, val, src) {
        var self = this;
        val && val.constructor===Spec && (val=val.toString());
        self.bundle[spec] = val; // TODO aggregation
        if (self.timeout === -1) {
            self.sendBundle();
            return;
        }
        var now = this.time(), gap = now-self.lastSendTS;
        self.timer = self.timer || setTimeout(function(){
            self.sendBundle();
            self.timer = null;
        }, gap>self.timeout ? PIPE.UNHERD*Math.random() : self.timeout-gap );
    };

// milliseconds as an int
    Pipe.prototype.time = function () { return new Date().getTime(); };
    Pipe.prototype.spec = function () { return new Spec('/Host#'+this._id); };

    Pipe.prototype.keepalive = function () {
        var now = this.time();
        if (now - this.lastSendTS > Pipe.KEEPALIVE_PERIOD_HALF) {
            this.sendBundle(); // empty "{}" message
        }
        if (now - this.lastRecvTS > Pipe.KEEPALIVE_PERIOD * 1.5) {
            this.stuck = true;
        }
        if (now-this.lastRecvTS > Pipe.KEEPALIVE_PERIOD * 4) {
            (this.console || console).log('probably dead pipe');
            this.close();
        }
    };

    Pipe.prototype.parseBundle = function pb (msg) {
        var bundle = this.serializer.parse(msg.toString()),
            spec_list = [], spec;
        //parse specifiers
        for(var key in bundle) key && spec_list.push(new Spec(key));
        spec_list.sort().reverse();
        while (spec = spec_list.pop()) {
            this.host.deliver(spec, bundle[spec], this);
        }
    };

    Pipe.prototype.sendBundle = function pS () {
        var self = this;
        var logger = self.console || console;
        var sendStr = self.serializer.stringify(self.bundle);
        self.bundle = {};
        if (!self.sink) { return; } //TODO ??? maybe throw new Error('no connection opened');

        try {
            if (Swarm.debug) { logger.log('goes to', (self._id || 'unintroduced'), sendStr); }
            self.sink.send(sendStr);
            self.lastSendTS = self.time();
        } catch (ex) {
            logger.error('send error'+ex); // ^ 'close' event assumed
            //self.close();
        }
    };


    return Swarm;
}));