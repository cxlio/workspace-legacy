
(function(ide, cxl, codeMirror) {
"use strict";
	
/**
 * Events:
 *
 * tokenchange
 * cursorchange
 */
ide.Editor.Source = ide.Editor.extend({

	editor: null,
	mode: null,

	// Stores previous token. Used by tokenchange event.
	_old_token: null,

	ascii: function()
	{
	var
		char = this.getChar(),
		code = char.charCodeAt(0)
	;
		ide.notify(char + ': ' + code + ' 0x' + code.toString(16) + ' 0' + code.toString(8));
	},

	deleteSelection: function()
	{
		this.editor.replaceSelection('');	
	},

	replaceSelection: function(text)
	{
		var e = this.editor, c;
		
		if (!this.somethingSelected())
		{
			c = e.getCursor();
			e.setSelection({ line: c.line, ch: c.ch+1 }, c);
		}
		
		e.replaceSelection(text, 'start');
	},
		
	enableInput: function()
	{	
		if (this.editor.getOption('disableInput'))
		{
			this.toggleFatCursor(false);
			this.editor.setOption('disableInput', false);
		}
	},

	disableInput: function()
	{
		if (this.editor.getOption('disableInput')===false)
		{
			// Go back one char if coming back from insert mode.
			if (this.editor.getCursor().ch>0)
				this.editor.execCommand('goCharLeft');

			this.toggleFatCursor(true);
			this.editor.setOption('disableInput', true);
			
		}
	},
	
	startSelect: function()
	{
		this.editor.display.shift = true;
	},
	
	endSelect: function()
	{
		this.editor.display.shift = false;
	},

	newline: function()
	{
		this.editor.execCommand('newlineAndIndent');	
	},

	clearSelection: function()
	{
		this.editor.setSelection(this.editor.getCursor('anchor'));
	},

	showCursorWhenSelecting: function()
	{
		this.editor.setOption('showCursorWhenSelecting', true);
	},

	selectLine: function()
	{
	var
		e = this.editor,
		anchor = e.getCursor('anchor'),
		head = e.getCursor(),
		anchorEnd = head.line>anchor.line ? 0 : e.getLine(anchor.line).length,
		headEnd = head.line>anchor.line ? e.getLine(head.line).length : 0	
	;
		e.setSelection(
			{ line: anchor.line, ch: anchorEnd },
			{ line: head.line, ch: headEnd },
			{ extending: true }
		);
	},

	cmd: function(fn, args)
	{
		if (!isNaN(fn))
			return this.go(fn);		 
		
		if (fn in codeMirror.commands)
			return codeMirror.commands[fn].call(codeMirror, this.editor);
		
		return ide.Editor.prototype.cmd.call(this, fn, args);
	},

	go: function(n)
	{
		this.editor.setCursor(n-1);
	},
	
	getLastChange: function()
	{
	var
		history = this.editor.getHistory().done,
		l = history.length
	;
		while (l--)
			if (history[l].changes)
				return history[l];
	},

	getValue: function()
	{
		return this.editor.getValue(this.options.lineSeparator);
	},

	getPosition: function()
	{
		return this.editor.getCursor();
	},
	
	_findMode: function()
	{
	var
		filename = this.file.get('filename'),
		info = filename && (codeMirror.findModeByFileName(filename) ||
			codeMirror.findModeByMIME(this.file.get('mime'))) ||
			codeMirror.findModeByMIME('text/plain'),
		mode = info.mode,
		me = this
	;
		function getScript(mode)
		{
			return 'codemirror/mode/' + mode + '/' + mode + '.js';
		}

		if (!codeMirror.modes[mode])
		{
			if (info.require)
				ide.loader.script(getScript(info.require));

			ide.loader.script(getScript(mode));
			ide.loader.ready(function() {
				me.editor.setOption('mode', info.mime || mode);
			});
			return;
		}
		
		return info.mime || mode;
	},
	
	_getOptions: function()
	{
		var ft = this._findMode(), s = ide.project.get('editor') || {};
		
		return (this.options = cxl.extend(
			{
				theme: 'twilight',
				tabSize: 4,
				indentWithTabs: true,
				lineWrapping: true,
				lineNumbers: true,
				electricChars: false,
				styleActiveLine: true,
				autoCloseTags: true,
				autoCloseBrackets: true,
				matchTags: true,
				matchBrackets: true,
				foldGutter: true,
				indentUnit: s.indentWithTabs ? 1 : (s.tabSize || 4), 
				lineSeparator: "\n",
				keyMap: 'default'
			}, s,
			{
				value: this.file.get('content') || '',
				mode: ft,
				scrollbarStyle: 'null',
				gutters: ['CodeMirror-lint-markers', "CodeMirror-linenumbers", 
				"CodeMirror-foldgutter"]	
			}
		));
	},
	
	/**
	 * Override keymap handle function to use codemirror plugin keymaps.
	 * TODO see if we can replace some plugins to avoid using this method.
	 */
	_keymapHandle: function(key)
	{
	var
		maps = this.editor.state.keyMaps,
		l = maps.length,
		fn, result
	;
		while (l--)
		{
			if ((fn = maps[l][key]))
			{
				result = fn(this.editor);

				if (result !== codeMirror.Pass)
					return result;
			}
		}
		
		return false;
	},

	_setup: function()
	{
	var
		options = this._getOptions(),
		editor = this.editor = codeMirror(this.el, options)
	;
		this.file_content = options.value;
		
		editor.on('focus', this._on_focus.bind(this));
		
		this.keymap = new ide.KeyMap();
		this.keymap.handle = this._keymapHandle.bind(this);
		this.listenTo(this.file, 'change:content', this._on_file_change);
	},

	resize: function()
	{
		setTimeout(this.editor.refresh.bind(this.editor), 200);
	},
	
	search: function(n)
	{
		if (n)
			this.editor.find(n);
	},

	/**
	 * Gets token at pos. If pos is ommited it will return the token
	 * under the cursor
	 */
	getToken: function(pos)
	{
		pos = pos || this.editor.getCursor();

		return this.editor.getTokenAt(pos, true);
	},

	getChar: function(pos)
	{
		var cursor = this.editor.getCursor();
		pos = pos || cursor;
		var result = this.editor.getRange(pos, 
			{ line: pos.line, ch: pos.ch+1 });
		
		this.editor.setCursor(cursor);
		
		return result;
	},

	/**
	 * Gets cursor element.
	 */
	/*get_cursor: function()
	{
		return this.editor.renderer.$cursorLayer.cursor;
	},*/
	
	somethingSelected: function()
	{
		return this.editor.somethingSelected();
	},

	getSelection: function()
	{
		return this.editor.getSelection(this.line_separator);
	},
	
	getLine: function(n)
	{
		n = n || this.editor.getCursor().line;
		
		return this.editor.getLine(n);
	},

	_on_focus: function()
	{
		this.focus(true);
		//this.sync_registers();
	},
	
	_on_file_change: function()
	{
		var content = this.file.get('content');
		
		if (!this.changed() && content!==this.file_content)
		{
		var
			editor = this.editor,
			cursor = editor.getCursor()
		;
			this.file_content = content;
			this.editor.operation(function() {
				editor.setValue(content);
				editor.setCursor(cursor);
			});
		}
	},

	focus: function(ignore)
	{
		ide.Editor.prototype.focus.apply(this);

		if (!ignore)
			this.editor.focus();
	},

	write: function(filename)
	{
		if (filename)
			this.file.set('filename', filename);
		else if (this.file_content !== this.file.get('content'))
			return ide.error('File contents have changed.');
		
		if (!this.file.get('filename'))
			return ide.error('No file name.');

		this.file.set('content', (this.file_content=this.getValue()));
		this.file.save();
	},

	insert: function(text)
	{
		this.editor.replaceSelection(text);
	},

	changed: function()
	{
		return this.file_content !== this.getValue();
	},

	getInfo: function()
	{
		return (this.changed() ? '+ ' : '') +
			(this.file.get('filename') || '[No Name]') +
			' [' + ide.project.get('name') + ']';
	},

	toggleFatCursor: function(state)
	{
		this.$el.toggleClass('cm-fat-cursor', state);
		this.editor.restartBlink();
	}

});

ide.plugins.register('editor', new ide.Plugin({

	edit: function(file, options)
	{
		if (!file.get('directory'))
		{
			if (!file.attributes.content)
				file.attributes.content = '';
			
		var
			editor = new ide.Editor.Source({
				slot: options.slot,
				plugin: this,
				file: file
			})
		;
			if (options && options.line)
				setTimeout(function() {
					editor.go(options.line);
				});

			ide.workspace.add(editor);

			return true;
		}
	}

}));

})(this.ide, this.cxl, this.CodeMirror);
