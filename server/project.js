/**
 *
 * workspace.project Plugin
 *
 */
"use strict";

var
	Q = require('bluebird'),
	cxl = require('cxl'),
	_ = require('lodash'),
	colors = require('colors'),
	micromatch = require('micromatch'),
	fs = require('fs'),

	common = require('./common.js'),

	//CONFIG_FILES = /bower\.json|package\.json|project\.json/,

	workspace = require('./workspace'),
	//chokidar = require('chokidar'),

	plugin = module.exports = cxl('workspace.project')
;

/**
 * Project Configuration (project.json)
 * 
 * Avoid using mutable objects as values to speed up diff algorithm.
 *
 */
function ProjectConfiguration(path) {
	var project = common.load_json_sync(this.path+'/project.json');
	
	cxl.extend(this, workspace.configuration.project_defaults, project);
	
	this.path = path;
	
	if (!this.ignore)
		this.ignore = [ '.*', 'node_modules', 'bower_modules' ];
	
	this.tags = {
		workspace: !!project
	};
}

cxl.extend(ProjectConfiguration.prototype, {
	
	/**
	 * Project name
	 */
	name: null,

	/**
	 * Project version.
	 */
	version: null,

	/**
	 * Project description.
	 */
	description: null
	
});

class Project {

	constructor(path)
	{
		this.path = path;
		this.clients = [];
		this.create();
	}
	
	create()
	{
	var
		config = this.configuration = new ProjectConfiguration(this.path)
	;
		workspace.plugins.emit('project.create', this);
		
		if (!config.name)
			config.name = config.path;
		
		return this;
	}

	resolve(promise)
	{
		var p = this.promises || (this.promises = []);

		p.push(promise);
	}

	generateIgnore()
	{
		var ignore = this.configuration.ignore = _.uniq(this.configuration.ignore);
		this.ignoreMatcher = function(path) {
			return micromatch.any(path, ignore);
		};
	}

	log(msg)
	{
		plugin.log(`${colors.yellow(this.path)} ${msg}`);
	}
	
	dbg(msg)
	{
		plugin.dbg(`${colors.yellow(this.path)} ${msg}`);
	}

	rebuildFiles()
	{
	var
		me = this, time = Date.now()
	;
		me.rebuilding = true;

		common.walk(this.path, this.ignoreMatcher, function(err, result) {
			me.rebuilding = false;

			if (err)
				return plugin.error(err);

			me.log(`${result.length} file(s) found (${Date.now()-time} ms).`);
			me.configuration.files = JSON.stringify(_.sortBy(result, 'filename'));
			me.broadcast({ files: me.configuration.files });
		});
	}

	getPayload(data)
	{
		return JSON.stringify({
			plugin: 'project',
			data: data
		});
	}

	broadcast(data)
	{
		var me = this, payload = me.getPayload(data);
		
		this.dbg(`Broadcasting ${payload} (${payload.length})`);

		this.clients.forEach(function(client) {
			client.send(payload);
		});
	}
	
	setConfig(attr)
	{
		var diff = common.diff(this.configuration, attr);
		this.broadcast(diff);
		
		this.configuration = attr;
	}

	onMessage(client, data)
	{
		if (this.clients.indexOf(client)===-1)
		{
			this.log(`Registering client ${client.id}.`);
			this.clients.push(client);
			client.send(this.getPayload(common.diff(data, this.configuration)));
		}
	}
	
	onWatch(ev, path)
	{
		if (ev!=='change')
		{
			if (!this.rebuilding)
				this.rebuildFiles();
		} else if (ev==='change')
		{
			workspace.plugins.emit('project.filechange:' + path, this, ev, path);
			
			if (path==='project.json')
				this.reload();
		}

		this.dbg(ev + ' ' + path);
	}

	onTimeout()
	{
		this.generateIgnore();

		if (!this.watcher)
		{
			this.dbg(`Watching ${this.path}`);
			this.watcher = fs.watch(this.path, this.onWatch.bind(this));
			/*this.watcher = chokidar.watch(this.path+'/', {
				ignored: this.configuration.ignore,
				followSymlinks: false,
				ignoreInitial: true,
				cwd: this.path
			});
			this.watcher.on('all', this.onWatch.bind(this));
			*/	
		}

		this.rebuildFiles();
	}

	onResolved()
	{
		setImmediate(this.onTimeout.bind(this));

		this.loaded = true;

		delete this.promises;

		return this.configuration;
	}

	onLoadFail(err)
	{
		return Q.reject(err);
	}
	
	reload()
	{
		this.log('Reloading project.');
		this.loaded = false;
		this.create().load().then(function(config) {
			this.setConfig(config);
		});
	}

	load()
	{
		if (this.loaded)
			return Q.resolve(this.configuration);

		this.log('Loading.');

		this.configuration.env = process.env;

		// Make sure project exists.
		this.resolve(common.stat(this.path));

		workspace.plugins.emit('project.load', this);

		return Q.all(this.promises).bind(this).then(this.onResolved, this.onLoadFail);
	}
}

cxl.define(Project, {

	/** @type {ProjectConfiguration} */
	configuration: null,
	
	loaded: false,
	
	watcher: null
	
});

class ProjectManager {

	constructor()
	{
		/**
		* List of projects
		*/
		this.projects = {};
		this.files = [];
		this.path = '.';
	}
	
	getProject(path)
	{
		if (!path)
			return null;
		
		return (this.projects[path] ||
			(this.projects[path] = new Project(path)));
	}

	loadProject(path)
	{
		return this.getProject(path).load();
	}

	loadAll()
	{
		return this.findProjects().then(function(projects) {
				return cxl.extend({
					projects: projects,
					files: JSON.stringify(this.files)
				}, workspace.configuration);
			});
	}

	load(path)
	{
		return path ? this.loadProject(path) : this.loadAll();
	}

	getProjectInformation(path)
	{
		if (!path.directory)
			return;

		this.files.push(path);
		this.projects[path.filename] = new Project(path.filename);
	}

	findProjects()
	{
	 return common.list(this.path)
	 	.bind(this)
	 	.each(this.getProjectInformation)
	 	.then(function() {
	 		return this.projects;
	 	});
	}
}

plugin.extend({
	onMessage: function(client, data)
	{
		var project = this.projectManager.getProject(data.path);

		if (project)
			project.onMessage(client, data);
	}
})
.config(function() {
	this.server = workspace.server;
	this.projectManager = new ProjectManager();
})
.run(function() {

	workspace.plugins.on('socket.message.project',
		this.onMessage.bind(this));

})
.route('GET', '/project', function(req, res) {

	this.projectManager.load(req.query.n).then(function(result) {
		res.send(result);
	}, common.sendError(this, res));
});
