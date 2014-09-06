"use strict";
var env = require('../lib/env');
var Spec = require('../lib/Spec');
var SecondPreciseClock = require('../lib/SecondPreciseClock');
var MinutePreciseClock = require('../lib/MinutePreciseClock');

env.debug = console.log;
env.multihost = true;

asyncTest('1.a timestamp sequence test', function () {
    var clock = new SecondPreciseClock('gritzko');
    expect(100);
    var ts1 = clock.issueTimestamp(), ts2, i=0;
    var iv = setInterval(function(){
        ts2 = clock.issueTimestamp();
        if (ts2<=ts1) {
            console.error(ts2, '<=', ts1);
        }
        if (i++==100) {
            start();
            clearInterval(iv);
        } else {
            ok(ts2 > ts1);
        }
        ts1 = ts2;
    }, 0);
    //swarm.close();
});

test('1.b basic specifier syntax', function (test) {
    var testSpec = '/Class#ID!7Umum+gritzko.event';
    var spec = new Spec(testSpec);
    equal(spec.version(),'7Umum+gritzko');
    equal(spec.token('!').ext,'gritzko');
    var rev = spec.toString();
    equal(rev,testSpec);
    /*var time = '20130811192020';
    var iso = Spec.timestamp2iso(time);
    var date = new Date(iso);
    test.equal(date.getMonth(),7); // zero based
    test.equal(date.getSeconds(),20);*/
    var spec2 = new Spec(spec);
    equal(spec.toString(),spec2.toString());
    var def = new Spec('/Type#id!ver.method');
    var over = def.set('#newid.newmethod');
    equal(over,'/Type#newid!ver.newmethod');
    var abc = new Spec('!abc');
    equal(abc.has('!ab'), false); // ?
    equal(abc.has('!'), true);
});

test('1.c spec filters', function () {
    var filter = '.on';
    equal (new Spec('!abc.on/Class').fits(filter), true);
    equal (new Spec('.off/Class').fits(filter), false);
    equal (new Spec('/Type!abc.off.on').fits(filter), true);

});

test('1.d version vector', function (){
    // the convention is: use "!version" for vectors and
    // simply "version" for scalars
    var vec = '!7AM0f+gritzko!0longago+krdkv!7AMTc+aleksisha!0ld!00ld#some+garbage';
    var map = new Spec.Map(vec);
    ok(map.covers('7AM0f+gritzko'));
    ok(!map.covers('7AMTd+aleksisha'));
    ok(!map.covers('6AMTd+maxmaxmax'));
    ok(map.covers('0ld'));
    ok(!map.covers('0le'));
    equal(map.map['swarm'],'0ld');
    ok(!('garbage' in map.map));
    equal(map.toString({rot:'6'}),'!7AMTc+aleksisha!7AM0f+gritzko');
    equal(map.toString({rot:'6',top:1}),'!7AMTc+aleksisha');
});

test('1.e corner cases', function () {
    var empty = new Spec('');
    equal(empty.type()||empty.id()||empty.op()||empty.version(),'');
    equal(empty.toString(),'');
    var action = new Spec('.on+re');
    equal(action.op(),'on+re');
    var fieldSet = new Spec('/TodoItem#7AM0f+gritzko!7AMTc+gritzko.set');
    equal(fieldSet.type(),'TodoItem');
    equal(fieldSet.id(),'7AM0f+gritzko');
    equal(fieldSet.version(),'7AMTc+gritzko');
    equal(fieldSet.op(),'set');
});

test('1.f minute-precise clox', function(test){
    var clock = new MinutePreciseClock('min');
    var prevts = '';
    for(var i=0; i<64; i++) {
        var ts = clock.issueTimestamp();
        ok(/^[0-9a-zA-Z_~]{5}\+min$/.test(ts));
        ok(ts>prevts);
        prevts = ts;
    }
    for(var i=0; i<130; i++) {
        var ts = clock.issueTimestamp();
    }
    ok(/^[0-9a-zA-Z_~]{7}\+min$/.test(ts));

    // tick 60 times
    // check the last char is changing
    // unless minute changed then restart
    // tick 60 times
    // see it spills over (extended ts)
});

test('1.g timestamp-ahead', function(test){
    var clock = new SecondPreciseClock('normal');
    var ts = clock.issueTimestamp();
    var parsed = clock.parseTimestamp(ts);
    var tenAhead = Spec.int2base(parsed.time+10, 5)+'+ahead';
    var tenBehind = Spec.int2base(parsed.time-10, 5)+'+behind';
    var clockAhead = new SecondPreciseClock('ahead', tenAhead);
    var clockBehind = new SecondPreciseClock('behind', tenBehind);
    var tsAhead = clockAhead.issueTimestamp();
    var tsBehind = clockBehind.issueTimestamp();
    ok(tsAhead>ts);
    ok(ts>tsBehind);
});

test('1.h timestamp to date', function(test){
    var clock = new SecondPreciseClock('normal');
    var ts = clock.issueTimestamp();
    var date = new Date();
    var recovered = clock.timestamp2date(ts);
    ok( Math.abs(date.getTime()-recovered.getTime()) < 2000 );
});


//var Empty = Swarm.Syncable.extend('Empty',{});

/*test('dry handshake', function () {
    var v = 0;
    var host = {
        _id: 'DummyHost',
        version: function () {
            return Spec.int2base(++v);
        },
        register: function (obj) {
            return obj;
        },
        availableUplinks: function (spec) {
            return spec.toString().indexOf('down')!==-1?[up]:[this];
        },
        on: function (stub,stub2,caller) {
            caller.reon(stub,'',this);
        },
        constructor: Host
    };
    var up = new Empty('up',{},host);
    var down = new Empty('down',{},host);
    // up.on('','!0',down);
    equal(up._lstn[0],host);
    equal(up._lstn[1],down);
    equal(down._lstn[0],up);
});*/

/*exports.testBase = function (test) {
    var obj = {
        '_vid': {
            text:   '!20130811192020&gritzko+iO',
            number: '!20130811192021&gritzko+iO',
            obj:    '!20130811192021+222&aleksisha',
            smth:   '!2013081019202+999&oldmf'
        },
        text: 'test',
        number: 123,
        obj: {},
        smth: 1
    };
    var base = Spec.getBase(obj);
    test.deepEqual(base,{
            '_':'20130811182021',
            'gritzko+iO':'20130811192021',
            'aleksisha':'20130811192021+222'
    });
    obj.smth = 4;
    var nts = '!20130811192028&gritzko+iO';
    obj['_vid'].smth = nts;
    var diff = Spec.getDiff(base,obj);
    test.equal(diff.smth,4);
    test.equal(diff['_vid'].smth, nts);
    test.done();
}*/
