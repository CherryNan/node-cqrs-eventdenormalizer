'use strict';

var debug = require('debug')('denormalizer:replayHandler'),
  _ = require('lodash'),
  async = require('async'),
  dotty = require('dotty');

/**
 * ReplayHandler constructor
 * @param {Object} disp    The dispatcher object.
 * @param {Object} store   The store object.
 * @param {Object} def     The definition object.
 * @param {Object} options The options object.
 * @constructor
 */
function ReplayHandler (disp, store, def, options) {
  this.dispatcher = disp;

  this.store = store;
  
  def = def || {};

  this.definition = {
    correlationId: 'correlationId', // optional
    id: 'id',                       // optional
    name: 'name',                   // optional
//      aggregateId: 'aggregate.id',    // optional
//      context: 'context.name',        // optional
//      aggregate: 'aggregate.name',    // optional
    payload: 'payload'              // optional
//      revision: 'revision'            // optional
//      version: 'version',             // optional
//      meta: 'meta'                    // optional, if defined theses values will be copied to the notification (can be used to transport information like userId, etc..)
  };

  this.definition = _.defaults(def, this.definition);

  options = options || {};

  this.options = options;
}

ReplayHandler.prototype = {

  /**
   * Updates the revision in the store.
   * @param {Object}   revisionMap The revision map.
   * @param {Function} callback    The function, that will be called when this action is completed.
   *                               `function(err){}`
   */
  updateRevision: function (revisionMap, callback) {
    var self = this;
    var ids = _.keys(revisionMap);
    async.each(ids, function (id, callback) {
      self.store.get(id, function (err, rev) {
        if (err) {
          return callback(err);
        }
        self.store.set(id, revisionMap[id] + 1, rev, callback);
      });
    }, callback);
  },

  /**
   * Replays all passed events.
   * @param {Array}    evts     The passed array of events.
   * @param {Function} callback The function, that will be called when this action is completed.
   *                            `function(err){}`
   */
  replay: function (evts, callback) {
    var self = this;
    
    var revisionMap = {};
    var viewBuilderMap = {};
    var groupedEvents = {};

    _.each(evts, function (evt) {
      if (!!self.definition.revision && dotty.exists(evt, self.definition.revision) &&
        !!self.definition.aggregateId && dotty.exists(evt, self.definition.aggregateId)) {
        var aggId = dotty.get(evt, self.definition.aggregateId);
        revisionMap[aggId] = dotty.get(evt, self.definition.revision);
      }

      var target = self.dispatcher.getTargetInformation(evt);

      var viewBuilders = self.dispatcher.tree.getViewBuilders(target);

      _.each(viewBuilders, function (vb) {
        viewBuilderMap[vb.workerId] = vb;
        groupedEvents[vb.workerId] = groupedEvents[vb.workerId] || [];
        groupedEvents[vb.workerId].push(evt);
      });
    });

    async.series([
      
      function (callback) {
        async.each(_.values(viewBuilderMap), function (vb, callback) {
          if (!groupedEvents[vb.workerId] || groupedEvents[vb.workerId].length === 0) {
            return callback(null);
          }

          vb.replay(groupedEvents[vb.workerId], callback);
        }, callback);
      },
      
      function (callback) {
        self.updateRevision(revisionMap, callback);
      }
      
    ], function (err) {
      if (err) {
        debug(err);
      }
      if (callback) {
        callback(err);
      }
    });
  },

  /**
   * Replays in a streamed way.
   * @param {Function} fn The function that will be called with the replay function and the done function.
   *                      `function(replay, done){}`
   */
  replayStreamed: function (fn) {
    var self = this;
    
    var revisionMap = {};
    var vbReplayStreams = {};

    var replay = function (evt) {
      if (!!self.definition.revision && dotty.exists(evt, self.definition.revision) &&
          !!self.definition.aggregateId && dotty.exists(evt, self.definition.aggregateId)) {
        var aggId = dotty.get(evt, self.definition.aggregateId);
        revisionMap[aggId] = dotty.get(evt, self.definition.revision);
      }

      var target = self.dispatcher.getTargetInformation(evt);

      var viewBuilders = self.dispatcher.tree.getViewBuilders(target);

      _.each(viewBuilders, function (vb) {

        if (!vbReplayStreams[vb.workerId]) {
          vb.replayStreamed(function (vbReplay, vbDone) {
            vbReplayStreams[vb.workerId] = {
              replay: vbReplay,
              done: vbDone
            };
          });
        }

        vbReplayStreams[vb.workerId].replay(evt);
      });
    };

    var done = function (callback) {
      async.series([
        function (callback) {
          async.each(_.values(vbReplayStreams), function (vbReplayStream, callback) {
            vbReplayStream.done(callback);
          }, callback);
        },
        function (callback) {
          self.updateRevision(revisionMap, callback);
        }
      ], function(err) {
        if (err) {
          debug(err);
        }
        if (callback) {
          callback(err);
        }
      });
    };

    fn(replay, done);
  }

};

module.exports = ReplayHandler;