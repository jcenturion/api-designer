(function () {
  'use strict';

  angular.module('codeMirror', ['raml', 'ramlEditorApp', 'codeFolding'])
    .factory('codeMirror', function (
      ramlHint, codeMirrorHighLight, generateSpaces, generateTabs,
      getFoldRange, isArrayStarter, getSpaceCount, getTabCount, config, extractKeyValue,
      eventEmitter, getNode, ramlEditorContext
    ) {
      var editor  = null;
      var service = {
        CodeMirror: CodeMirror
      };

      service.removeTabs = function (line, indentUnit) {
        var spaceCount = getTabCount(getSpaceCount(line), indentUnit) * indentUnit;
        return spaceCount ? line.slice(spaceCount) : line;
      };

      service.tabKey = function (cm) {
        var cursor     = cm.getCursor();
        var line       = cm.getLine(cursor.line);
        var indentUnit = cm.getOption('indentUnit');
        var spaces;
        var result;
        var unitsToIndent;

        if (cm.somethingSelected()) {
          cm.indentSelection('add');
          return;
        }

        result = service.removeTabs(line, indentUnit);
        result = result.length ? result : '';

        // if in half/part of a tab, add the necessary spaces to complete the tab
        if (result !== '' && result.replace(/ /g, '') === '') {
          unitsToIndent = indentUnit - result.length;
        // if not ident normally
        } else {
          unitsToIndent = indentUnit;
        }

        spaces = generateSpaces(unitsToIndent);
        cm.replaceSelection(spaces, 'end', '+input');
      };

      service.backspaceKey = function (cm) {
        var cursor          = cm.getCursor();
        var line            = cm.getLine(cursor.line).slice(0, cursor.ch);
        var indentUnit      = cm.getOption('indentUnit');
        var spaceCount      = line.length - line.replace(/\s+$/, '').length;
        var lineEndsWithTab = spaceCount >= indentUnit;

        // delete indentation if there is at least one right before
        // the cursor and number of whitespaces is a multiple of indentUnit
        //
        // we do it for better user experience as if you had 3 whitespaces
        // before cursor and pressed Backspace, you'd expect cursor to stop
        // at second whitespace to continue typing RAML content, otherwise
        // you'd end up at first whitespace and be forced to hit Spacebar
        if (lineEndsWithTab && (spaceCount % indentUnit) === 0) {
          for (var i = 0; i < indentUnit; i++) {
            cm.deleteH(-1, 'char');
          }
          return;
        }

        cm.deleteH(-1, 'char');
      };

      var MODES = {
        xml: { name: 'xml' },
        xsd: { name: 'xml', alignCDATA: true },
        json: { name: 'javascript', json: true },
        md: { name: 'gfm' },
        raml: { name: 'raml' }
      };

      // TODO: Implement Cmd or Ctrl is Mac or windows
      var mac  = CodeMirror.keyMap["default"] == CodeMirror.keyMap.macDefault;
      var ctrl = mac ? "Cmd-" : "Ctrl-";

      var defaultKeys = {
        'Cmd-S': 'save',
        'Ctrl-S': 'save',
        'Shift-Tab': 'indentLess',
        'Shift-Ctrl-T': 'toggleTheme',
        'Cmd-P': 'showOmniSearch',
        'Ctrl-Space': 'autocomplete',
        'Shift-Cmd-S': 'saveAll',
        'Shift-Ctrl-S': 'saveAll',
        'Cmd-D': CodeMirror.sublimeKeyMap['Cmd-D'],
        'Cmd-L': CodeMirror.sublimeKeyMap['Cmd-L'],
        'Cmd-Ctrl-Up': CodeMirror.sublimeKeyMap['Cmd-Ctrl-Up'],
        'Cmd-Ctrl-Down': CodeMirror.sublimeKeyMap['Cmd-Ctrl-Down'],
        'Shift-Alt-Up': CodeMirror.sublimeKeyMap['Shift-Alt-Up'],
        'Shift-Alt-Down': CodeMirror.sublimeKeyMap['Shift-Alt-Down'],
        'Shift-Cmd-D': CodeMirror.sublimeKeyMap['Shift-Cmd-D'],

        'Cmd-K Cmd-K': 'save',
        'Cmd-K Cmd-U': CodeMirror.sublimeKeyMap['Cmd-K Cmd-U'],
        'Cmd-K Cmd-L': CodeMirror.sublimeKeyMap['Cmd-K Cmd-L'],
        'Cmd-K Cmd-j': CodeMirror.sublimeKeyMap['Cmd-K Cmd-j']
      };

      var ramlKeys = {
        'Ctrl-Space': 'autocomplete',
        'Cmd-S': 'save',
        'Ctrl-S': 'save',
        'Shift-Tab': 'indentLess',
        'Shift-Ctrl-T': 'toggleTheme',
        'Cmd-P': 'showOmniSearch',
        'Ctrl-/': 'toggleComment',
        'Cmd-/': 'toggleComment',
        'Ctrl-E': 'extractTo',
        'Cmd-E': 'extractTo',
        'Shift-Cmd-S': 'saveAll',
        'Shift-Ctrl-S': 'saveAll',
        'Cmd-D': CodeMirror.sublimeKeyMap['Cmd-D'],
        'Cmd-L': CodeMirror.sublimeKeyMap['Cmd-L'],
        'Cmd-Ctrl-Up': CodeMirror.sublimeKeyMap['Cmd-Ctrl-Up'],
        'Cmd-Ctrl-Down': CodeMirror.sublimeKeyMap['Cmd-Ctrl-Down'],
        'Shift-Cmd-D': CodeMirror.sublimeKeyMap['Shift-Cmd-D'],
        'Cmd-K Cmd-K': CodeMirror.sublimeKeyMap['Cmd-K Cmd-K'],
        'Cmd-K Cmd-U': CodeMirror.sublimeKeyMap['Cmd-K Cmd-U'],
        'Cmd-K Cmd-L': CodeMirror.sublimeKeyMap['Cmd-K Cmd-L'],
        'Shift-Alt-Up': CodeMirror.sublimeKeyMap['Shift-Alt-Up'],
        'Shift-Alt-Down': CodeMirror.sublimeKeyMap['Shift-Alt-Down'],
        'Cmd-K Cmd-j': CodeMirror.sublimeKeyMap['Cmd-K Cmd-j']
        // 'Shift-Cmd-Space': CodeMirror.sublimeKeyMap['Shift-Cmd-Space'] // TODO: Select Resource
      };

      var autocomplete = function onChange(cm) {
        if (cm.getLine(cm.getCursor().line).trim()) {
          cm.execCommand('autocomplete');
        }
      };

      service.configureEditor = function(editor, extension) {
        var mode = MODES[extension] || MODES.raml;

        editor.setOption('mode', mode);
        if (mode.name === 'raml') {
          editor.setOption('extraKeys', ramlKeys);
          editor.on('change', autocomplete);
        } else {
          editor.setOption('extraKeys', defaultKeys);
          editor.off('change', autocomplete);
        }
      };

      service.enterKey = function (cm) {
        function getParent(lineNumber, spaceCount) {
          for (var i = lineNumber - 1; i >= 0; i--) {
            if (getSpaceCount(cm.getLine(i)) < spaceCount) {
              return extractKeyValue(cm.getLine(i)).key;
            }
          }
        }

        var cursor          = cm.getCursor();
        var endOfLine       = cursor.ch >= cm.getLine(cursor.line).length - 1;
        var line            = cm.getLine(cursor.line).slice(0, cursor.ch);
        var lineStartsArray = isArrayStarter(line);
        var spaceCount      = getSpaceCount(line);
        var spaces          = generateSpaces(spaceCount);
        var parent          = getParent(cursor.line, spaceCount);
        var traitOrType     = ['traits', 'resourceTypes'].indexOf(parent) !== -1;

        if (endOfLine) {
          (function () {
            if (traitOrType) {
              spaces += generateTabs(2);
              return;
            } else if (lineStartsArray) {
              spaces += generateTabs(1);
            }

            if (line.replace(/\s+$/, '').slice(-1) === '|') {
              spaces += generateTabs(1);
              return;
            }

            var nextLine = cm.getLine(cursor.line + 1);
            if (nextLine && getSpaceCount(nextLine) > spaceCount) {
              spaces += generateTabs(1);
            }
          })();
        } else {
          if (lineStartsArray) {
            spaces += generateTabs(1);
          }
        }

        cm.replaceSelection('\n' + spaces, 'end', '+input');
      };

      service.createEditor = function (el, extraOptions) {
        var shouldEnableFoldGutter = JSON.parse(config.get('folding', 'true'));
        var foldGutterConfig       = false;
        var cm;
        var options;

        if (shouldEnableFoldGutter) {
          foldGutterConfig = {
            rangeFinder:            CodeMirror.fold.indent,
            foldOnChangeTimeSpan:   300,
            updateViewportTimeSpan: 200
          };
        }

        options = {
          styleActiveLine: true,
          mode: 'raml',
          theme: 'solarized dark',
          lineNumbers: true,
          lineWrapping: true,
          autofocus: true,
          indentWithTabs: false,
          indentUnit: 2,
          tabSize: 2,
          keyMap: 'tabSpace',
          foldGutter: foldGutterConfig,
          gutters: ['CodeMirror-lint-markers', 'CodeMirror-linenumbers', 'CodeMirror-foldgutter']
        };

        if (extraOptions) {
          Object.keys(extraOptions).forEach(function (key) {
            options[key] = extraOptions[key];
          });
        }

        cm = new CodeMirror(el, options);
        cm.setSize('100%', '100%');
        cm.foldCode(0, {
          rangeFinder: CodeMirror.fold.indent
        });

        service.cm = cm;

        var charWidth   = cm.defaultCharWidth();
        var basePadding = 4;

        cm.on('renderLine', function (cm, line, el) {
          var offset = CodeMirror.countColumn(line.text, null, cm.getOption('tabSize')) * charWidth;

          el.style.textIndent  = '-' + offset + 'px';
          el.style.paddingLeft = (basePadding + offset) + 'px';
        });

        cm.on('mousedown', function (cm, event) {
          var target = event.target;

          if (target.className === 'cm-link') {
            var path = target.innerText.match(/!include(.*)/).pop().trim();
            eventEmitter.publish('event:editor:include', {path: path});
          }
        });

        cm.on('cursorActivity', function () {
          eventEmitter.publish('event:editor:context', {
            context: ramlEditorContext.context,
            cursor:  cm.getCursor()
          });
        });

        cm.on('change', function (cm) {
          cm.operation(function() {
            ramlEditorContext.read(cm.getValue().split('\n'));
          });
        });

        cm.on('mousedown', function () {
          eventEmitter.publish('event:editor:click');
        });

        cm.on('focus', function (cm) {
          cm.operation(function() {
            if (Object.keys(ramlEditorContext.context).length > 0) {
              eventEmitter.publish('event:editor:context', {
                context: ramlEditorContext.context,
                cursor:  cm.getCursor()
              });
            }
          });
        });

        return cm;
      };

      service.initEditor = function () {
        var el = document.getElementById('code');
        var cm = service.createEditor(el);

        // for testing automation purposes
        editor = window.editor = cm;

        return cm;
      };

      service.getEditor = function () {
        return editor;
      };

      (function bootstrap() {
        CodeMirror.keyMap.tabSpace = {
          Tab:         service.tabKey,
          Backspace:   service.backspaceKey,
          Enter:       service.enterKey,
          fallthrough: 'default'
        };

        function parseLine(line) {
          return isNaN(line) ? 0 : line-1;
        }

        function scrollTo(position) {
          var cm     = window.editor;
          var height = cm.getScrollInfo().clientHeight;
          var coords = cm.charCoords(position, 'local');
          cm.setCursor(position);
          cm.scrollTo(null, (coords.top + coords.bottom - height) / 2);
        }

        eventEmitter.subscribe('event:goToLine', function (search) {
          var position = {line: parseLine(search.line), ch: 0};

          if (search.focus) {
            window.editor.focus();
          }

          scrollTo(position);
        });

        eventEmitter.subscribe('event:goToResource', function (search) {
          var context  = ramlEditorContext.context;
          var root     = '/'+search.scope.split('/')[1];
          var metadata = context.metadata[root] || context.metadata[search.scope];
          var startAt  = metadata.startAt;
          var endAt    = metadata.endAt || context.content.length;
          var line     = 0;
          var cm       = window.editor;
          var path     = null;
          var resource = search.text;

          if (search.text !== search.resource) {
            path = '';
            var fragments = search.scope.split('/');

            fragments = fragments.slice(1, fragments.length);

            for(var j = 0; j <fragments.length; j++) {
              var el = fragments[j];

              if(el !== resource) {
                path+='/'+el;
              }

              if (el === resource && search.index && search.index === j) {
                path+='/'+el;
                break;
              } else if (el === resource && search.index) {
                path+='/'+el;
              }

              if(!search.index && el === resource) {
                path+='/'+el;
                break;
              }
            }
          }

          path = path ? path : search.scope;

          for(var i = startAt; i <= endAt; i++) {
            if (context.scopes[i].indexOf(path) !== -1) {
              line = i;
              break;
            }
          }

          if (search.focus) {
            cm.focus();
          }

          scrollTo({line: line, ch: 0});
        });

        CodeMirror.commands.save = function save() {
          eventEmitter.publish('event:save');
        };

        CodeMirror.commands.autocomplete = function autocomplete(cm) {
          CodeMirror.showHint(cm, CodeMirror.hint.raml, {
            ghosting: true
          });
        };

        CodeMirror.commands.toggleTheme = function toggleTheme() {
          eventEmitter.publish('event:toggle-theme');
        };

        CodeMirror.commands.showOmniSearch = function showOmniSearch() {
          eventEmitter.publish('event:open:omnisearch');
        };

        CodeMirror.commands.extractTo = function extractTo(cm) {
          eventEmitter.publish('event:editor:extract-to', cm);
        };

        CodeMirror.commands.saveAll = function saveAll() {
          eventEmitter.publish('event:notification:save-all', {notify: true});
        };

        function toggleComment (content) {
          if (content.replace(/\s/g, '').indexOf('#')) {
            content = '# ' + content;
          } else {
            content = content.replace(/# /g, '');
          }

          return content;
        }

        CodeMirror.commands.toggleComment = function (cm) {
          var selection   = cm.getSelection();
          var currentLine = cm.getCursor().line;
          var content     = cm.getLine(currentLine);

          if (selection.replace(/\s/g, '')) {
            var lines = selection.split('\n');

            for(var i = 0; i < lines.length; i++) {
              lines[i] = toggleComment(lines[i]);
            }

            cm.replaceSelection(lines.join('\n'));
          } else {
            cm.replaceRange(toggleComment(content), {
              line: currentLine,
              ch: 0
            }, {
              line: currentLine,
              ch: cm.getLine(currentLine).length
            });
          }
        };

        CodeMirror.defineMode('raml', codeMirrorHighLight.highlight);
        CodeMirror.defineMIME('text/x-raml', 'raml');

        CodeMirror.registerHelper('hint', 'raml', ramlHint.autocompleteHelper);
        CodeMirror.registerHelper('fold', 'indent', getFoldRange);
      })();

      return service;
    })
  ;
})();
