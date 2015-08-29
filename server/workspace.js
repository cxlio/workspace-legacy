/**
 *
 * workspace Module
 *
 */
"use strict";

var
	EventEmitter = require('events').EventEmitter,
	fs = require('fs'),
	bodyParser = require('body-parser'),
	compression = require('compression'),
	path = require('path'),
	_ = require('lodash'),
	Q = require('bluebird'),

	cxl = require('cxl'),

	common = require('./common.js'),
	Watcher = require('./watcher.js'),

	basePath = path.resolve(__dirname + '/../'),
	workspace = global.workspace = module.exports = cxl('workspace')
;

class Configuration {

	constructor()
	{
		this.loadFile('~/.workspace/config.json');
		this.loadFile('workspace.json');

		cxl.extend(this, {
			version: '0.3.0',
			user: process.env.USER || process.env.USERNAME
		});

		if (this.debug)
			cxl.enableDebug();

		var secure = this.secure;

		if (secure)
		{
			this.https = {
				key: fs.readFileSync(secure.key),
				cert: fs.readFileSync(secure.cert)
			};
		}
	}
	
	/**
	 * Loads a JSON configuration file.
	 */
	loadFile(fn)
	{
		workspace.log('Loading settings from ' + fn);
		common.extend(this, common.load_json_sync(fn));

		return this;
	}
}

cxl.define(Configuration, {

	/**
	 * Enable Debug Mode.
	 */
	debug: false,

	/**
	 * Port to start the server
	 */
	port: 9001,

	/**
	 * Whether or not to use encryption. HTTPS and WSS
	 *
	 * Object containing key and cert filenames.
	 *
	 * @type {object}
	 */
	secure: null

});

/**
 * Plugin Manager
 */
class PluginManager extends EventEmitter {

	constructor()
	{
		super();
		
		this.plugins = {};
		this.sources = {};		
	}

	/**
	 * Registers a plugin
	 *
	 * @param {cxl.Module} cxl Module
	 */
	register(plugin)
	{
		if (plugin.name in this.plugins)
			workspace.log(`WARNING Plugin ${plugin.name} already registered.`);
						  
		this.plugins[plugin.name] = plugin;
		
		return this;
	}
	
	requireFile(file)
	{
		var plugin = require(file);

		this.register(plugin);
		this.sources[plugin.name] = plugin.source ? _.result(plugin, 'source') :
			(plugin.sourcePath ? common.read(plugin.sourcePath) : '');
		
		return plugin;
	}
	
	requirePlugins(plugins)
	{
		_.each(plugins, this.requirePlugin, this);
	}
	
	requirePlugin(name)
	{
	var
		parsed = /^(?:(\w+):)?(.+)/.exec(name)
	;
		if (parsed[1]==='file')
			return this.requireFile(path.resolve(parsed[2]));
		
		return this.requireFile(this.path + '/' + name);
	}
	
	setupFirebase()
	{
		this.fb = workspace.fb.child('plugins');
		this.fb.on('value', function(data) {
			this.available = data;
		}, this);
	}

	start()
	{
	var
		plugins = workspace.configuration.plugins
	;
		this.path = workspace.configuration['plugins.path'] ||
			(basePath + '/plugins');
		this.package = workspace.data('plugins');
		
		this.requirePlugins(plugins);
		
		Q.props(this.sources).bind(this).then(function(sources) {
			this.sources = sources;
			
			for (var i in this.plugins)
				this.plugins[i].start();

			this.setupFirebase();
			
			setImmediate(this.emit.bind(this, 'workspace.load', workspace));
		});
	}

}

workspace.extend({

	configuration: new Configuration(),
	plugins: new PluginManager(),
	basePath: basePath,
	common: common,

	_: _,
	Q: Q,
	
	__data: null,
	__dataFile: basePath + '/data.json',
	
	/**
	 * Persist data for plugins.
	 */
	data: function(plugin, data)
	{
		if (arguments.length===1)
			return this.__data[plugin];
		
		this.__data[plugin] = data;
		this.__saveData();
	},
	
	__saveData: function()
	{
		var me = this;
		
		if (this.__dataTimeout)
			clearTimeout(this.__dataTimeout);
		
		this.__dataTimeout = setTimeout(function() {
			me.dbg(`Writing data file. ${me.__dataFile} (${Buffer.byteLength(me.__data)} bytes)`);
			
			common.writeFile(me.__dataFile, JSON.stringify(me.__data));
		});
	},
	
	onWatch: function()
	{
		this.configuration= new Configuration();
		workspace.plugins.emit('workspace.reload');
	}

}).config(function()
{
	this.port = this.configuration.port;
	this.watcher = new Watcher({
		onEvent: this.onWatch.bind(this)
	});

	common.stat('workspace.json')
		.then(this.watcher.watchFile.bind(this.watcher, 'workspace.json'),
			this.log.bind(this, 'No workspace.json found.'));
	
	this.__data = common.load_json_sync(this.__dataFile) || {};
	
	process.title = 'workspace:' + this.port;
	
	// Register Default Plugins
	this.plugins.register(require('./project'))
		.register(require('./file'))
		.register(require('./socket'))
		.register(require('./online'))
	;
	
})

.createServer()

.use(compression())

.use(cxl.static(basePath + '/public', { maxAge: 86400000 }))

.use(cxl.static(basePath + '/node_modules', { maxAge: 86400000 }))

.use(bodyParser.json({ limit: Infinity }))

.run(function() {
	this.plugins.start();
});

