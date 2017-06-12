/**
 * workspace.project
 */

(function(cxl, ide) {
"use strict";

var loginForm;

function createProject()
{
	return cxl.ajax.post('/project', { path: ide.project.id }).then(function() {
		return ide.project.fetch();
	});
}

function cancelProject()
{
	ide.error('Error loading project "' + ide.project.id + '"');
	ide.hash.set({ p: null });
	ide.project.set('path', '.');

	return ide.project.fetch();
}

function onProjectError(e)
{
	ide.project.fetching = false;
	// Project does not exist
	if (e.status===404)
	{
		return ide.confirm({ message: 'Project does not exists. Create?', action: 'Create'})
			.then(createProject, cancelProject);
	} else if (e.status===401)
		doLogin();

	return cxl.Promise.reject(e);
}

function onLoginAuth(login)
{
	loginForm = null;
	login.remove();
	login.destroy();
	ide.workspace.el.style.opacity = 1;
	ide.project.fetch();
}

function doLogin()
{
	if (loginForm)
		return;

	loginForm = new ide.LoginComponent();
	loginForm.on('auth', onLoginAuth.bind(null, loginForm));
	document.body.appendChild(loginForm.$native);
	ide.workspace.el.style.opacity = 0;
}

ide.Project = cxl.Model.extend({

	idAttribute: 'path',

	url: function()
	{
		return '/project' + (this.id ? '?n=' + this.id : '');
	},

	initialize: function()
	{
		this.reload = cxl.debounce(this.fetch.bind(this), 500);
		ide.plugins.on('socket.message.project', this.onMessage, this);
	},

	loadTheme: function(css)
	{
		var body = document.body;

		if (this.themeEl)
			body.removeChild(this.themeEl);

		this.themeEl = document.createElement('STYLE');
		this.themeEl.innerHTML = css;
		body.appendChild(this.themeEl);
	},

	onFatalError: function(e)
	{
		if (e.status!==401)
			ide.error('Could not load workspace');

		this.fetching = null;
	},

	fetch: function()
	{
		if (this.fetching)
			return this.fetching;

		if (loginForm)
			return cxl.Promise.reject();

		var fetch = cxl.Model.prototype.fetch.call(this);

		return (this.fetching = fetch.catch(onProjectError)
			.then(this.onProject.bind(this), this.onFatalError.bind(this)));
	},

	parse: function(data)
	{
		if (data.files)
			this.set_files(data.files);
		if (data['ignore.regex'])
			this.ignoreRegex = new RegExp(data['ignore.regex']);
		if (data['theme.css'])
			this.loadTheme(data['theme.css']);

		if (!this.hint)
			this.hint = new ide.DynamicItem({ priority: 0, code: 'project' });

		this.hint.title = data.name || data.path;
		this.hint.tags = data.tags;

		return data;
	},

	onMessage: function(msg)
	{
		if (!msg) return;

		if (msg.reload===true)
			this.reload();

		if (msg.notify)
			ide.notify(msg.notify);
	},

	onProject: function()
	{
		this.fetching = null;

		this.hint.icons = this.get('icons');
		ide.plugins.trigger('project.load', this);

		if (ide.plugins.started)
			return;

		ide.plugins.start();
		ide.keymap.start();
		ide.plugins.ready();
		ide.hash.loadFiles();
	},

	set_files: function(files)
	{
		this.attributes.files = files;
		files.forEach(function(f) {
			Object.defineProperty(f, 'hint', {
				value: new ide.Item({
					title: f.filename, icon: f.icon || (f.directory ? 'directory' : 'file')
				})
			});
		});
	}

});

class ProjectList extends ide.ListEditor {

	render(p)
	{
		p.title = this.command = 'projects';
		super.render(p);
		this._loadProjects();
	}

	_loadProjects()
	{
		cxl.ajax.get('/projects').then(this._renderProjects.bind(this));
	}

	_renderProjects(projects)
	{
	var
		all = Object.values(projects).map(function(p) {

			return new ide.Item({
				code: p.path,
				title: p.name || p.path,
				tags: p.tags,
				description: p.description,
				icons: p.icons,
				enter: function()
				{
					ide.run('project', [p.path]);
				}
			});
		})
	;
		this.add(cxl.sortBy(all, 'title'));
	}

}

ide.registerCommand('projects', {

	fn: function()
	{
		return new ProjectList({ plugin: this });
	},
	description: 'Show current workspace projects'

});

/**
 * Open project by path
 */
ide.registerCommand('project', {
	fn: function(name) {
		var hash = '#' + ide.hash.encode({ p: name || null, f: null });
		if (ide.project.id!=='.' || ide.workspace.slots.length)
			window.open(hash);
		else
		{
			window.location = hash;
			window.location.reload();
		}
	},
	args: [ 'project' ],
	description: 'Load or create project'
});

ide.registerCommand('project.settings', {
	fn: function() {
		ide.open({ file: 'project.json' });
	},
	icon: 'cog'
});



})(this.cxl, this.ide);
