/*******************************************************************************
 * @license
 * Copyright (c) 2012 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License v1.0
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html).
 *
 * Contributors:
 *     Kris De Volder (VMWare) - initial API and implementation
 *******************************************************************************/

/*global define window*/
/*jslint browser:true*/

define(['require', 'dojo', 'dijit', 'orion/bootstrap', 'orion/commands', 'orion/fileClient', 'orion/searchClient', 'orion/globalCommands',
		'orion/widgets/Console', 'console/current-directory', 'console/paramType-file', 'orion/plugin'], 
	function(require, dojo, dijit, mBootstrap, mCommands, mFileClient, mSearchClient, mGlobalCommands, mConsole, mCurrentDirectory, mFileParamType) {

	var fileClient;

	/* implementation of the 'edit' command */

	function editExec(node) {
		var href = "/edit/edit.html#" + node.file.Location;
		window.open(href);
	}

	/* implementation of the 'ls' command */

	/* formats a directory child node */
	function formatLsChild(node, result) {
		result = result || [];
		if (node.Name) {
			if (node.Directory) {
				result.push(node.Name);
				result.push('/');
			} else { 
				result.push('<a href="/edit/edit.html#' + node.Location + '">');
				result.push(node.Name); //TODO html escape sequences?
				result.push('</a>');
			}
			result.push('<br>');
		}
		return result;
	}

	function formatFullPath(node) {
		var path = fileClient.fileServiceName(node.Location);
		var parents = node.Parents;
		// TODO it could be useful to make the path segments link to something
		// useful, see breadcrumb.js for an idea
		if (parents) {
			path += '/';
			for (var i = parents.length; --i >= 0 ;){
				path += parents[i].Name; 
				path += '/';
			}
			path += node.Name;
		}
		if (node.Directory) {
			path += '/';
		}
		return path;
	}

	/*
	 * Formats the children of a current file or workspace node.  Optionally accepts
	 * an array 'result' to which the resulting Strings are pushed.
	 * 
	 * To avoid massive String copying, the result is returned as an array of
	 * Strings rather than one massive String. Caller should join('') the returned result.
	 */
	function formatLs(node, result, func) {
		result = result || [];
		mCurrentDirectory.withChildren(node, function(children) {
			for (var i = 0; i < children.length; i++) {
				formatLsChild(children[i], result);
			}
			func(result);
		});
	}

	function lsExec(args, context) {
		var result = context.createPromise();
		mCurrentDirectory.setCurrentTreeNode(null); /* flushes current node cache */
		mCurrentDirectory.withCurrentTreeNode(function(node) {
			formatLs(node, [], function(buffer) {
				result.resolve(buffer.join(''));
			});
		});
		return result;
	}

	/* implementaton of the 'cd' command */

	function cdExec(args, context) {
		var targetDirName = args.directory;
		if (typeof(targetDirName) !== "string") {
			targetDirName = targetDirName.Name;
		}
		var result = context.createPromise();
		mCurrentDirectory.withCurrentTreeNode(function(node) {
			if (targetDirName === '..') {
				fileClient.read(node.Location, true).then(
					dojo.hitch(this, function(metadata) {
						if (metadata.Parents && metadata.Parents.length > 0) {
							var parentLocation = metadata.Parents[0].Location;
							fileClient.read(parentLocation, true).then(
								dojo.hitch(this, function(parentMetadata) {
									dojo.hash(parentMetadata.Location);
									var buffer = formatFullPath(parentMetadata);
									result.resolve("Changed to: <b>" + buffer + "</b>");
								})
							);
						} else {
							dojo.hash("#");
							var buffer = fileClient.fileServiceName(metadata.Location);
							result.resolve("Changed to: <b>" + buffer + "</b>");
						}
						mCurrentDirectory.setCurrentTreeNode(null);
					})
				);
			} else {
				mCurrentDirectory.withChildren(node, function(children) {
					var found = false;
					for (var i = 0; i < children.length; i++) {
						var child = children[i];
						if (child.Name === targetDirName) {
							if (child.Directory) {
								found = true;
								mCurrentDirectory.setCurrentTreeNode(child);
								fileClient.read(child.Location, true).then(
									dojo.hitch(this, function(metadata) {
										var buffer = formatFullPath(metadata);
										result.resolve("Changed to: <b>" + buffer + "</b>");
									})
								);
							} else {
								result.resolve("<em>" + targetDirName + " is not a directory</em>");
							}
						}
					}
					if (!found) {
						result.resolve("<em>" + targetDirName + " was not found</em>");
					}
				});
			}
		});
		return result;
	}

	/* implementation of the 'pwd' command */

	function pwdExec(args, context) {
		var result = context.createPromise();
		mCurrentDirectory.withCurrentTreeNode(function(node) {
			fileClient.read(node.Location, true).then(
				dojo.hitch(this, function(metadata) {
					var buffer = formatFullPath(metadata);
					result.resolve("<b>" + buffer + "</b>");
				})
			);
		});
		return result;
	}

	/* methods for handling contributed commands */

	/*
	 * Creates a JSON object with context information an external command
	 * may need access to in order to execute.
	 */
	function createPluginContext(gcliContext, func) {
		mCurrentDirectory.withWorkspace(function(wsNode) {
			mCurrentDirectory.withCurrentTreeNode(function(pwdNode) {
				return func({
					location: pwdNode.Location,
					workspaceLocation: wsNode.Location
				});
			});
		});
	}

	/*
	 * Creates a gcli exec function that wraps a 'callback' function contributed by
	 * an 'orion.console.command' service implementation.
	 */
	function contributedExecFunc(service) {
		if (typeof(service.callback) === 'function') {
			//TODO: we may support different styles of exec functions based on 
			// properties set in the service. For now we just have the one
			// type that executes asynchronously and renders the result as 'pre' text.
			return function(args, context) {
				var promise = context.createPromise();
				createPluginContext(context, function(jsonContext) {
					service.callback(args, jsonContext).then(function(result) {
						promise.resolve(result);
					});
				});
				return promise;
			};
		}
		return undefined; 
		//returns undefined if we can't create an exec function (typically because the 
		//service doesn't provide one and is just a parent node in the command hierarchy).
	}

	dojo.addOnLoad(function() {
		mBootstrap.startup().then(function(core) {
			var serviceRegistry = core.serviceRegistry;
			var preferences = core.preferences;
			document.body.style.visibility = "visible";
			dojo.parser.parse();

			var commandService = new mCommands.CommandService({serviceRegistry: serviceRegistry});
			fileClient = new mFileClient.FileClient(serviceRegistry);
			var searcher = new mSearchClient.Searcher({serviceRegistry: serviceRegistry, commandService: commandService, fileService: fileClient});
			mGlobalCommands.generateBanner("toolbar", serviceRegistry, commandService, preferences, searcher);

			var console = new mConsole.Console(dojo.byId("console-input"), dojo.byId("console-output"));
			/* the Console creates a child of console-input, resize to give it a height */
			dijit.byId("centerPane").resize();

			/* add the locally-defined types */
			var directoryType = new mFileParamType.ParamTypeFile("directory", true, false);
			console.addType(directoryType);
			var fileType = new mFileParamType.ParamTypeFile("file", false, true);
			console.addType(fileType);

			/* add the locally-defined commands */
			console.addCommand({
				name: 'cd',
				description: 'Change current directory',
				callback: cdExec,
				returnType: 'string',
				parameters: [
						    {
								name: 'directory',
								type: 'directory',
								description: 'Directory'
						    }
				]
			});
			console.addCommand({
				name: 'edit',
				description: 'Edit a file',
				callback: editExec,
				returnType: 'string',
				parameters: [
						    {
								name: 'file',
								type: 'file',
								description: 'File'
						    }
				]
			});
			console.addCommand({
				name: 'ls',
				description: 'Show a list of files in the current directory',
				callback: lsExec,
				returnType: 'string'
			});
			console.addCommand({
				name: 'pwd',
				description: 'Print current directory',
				callback: pwdExec,
				returnType: 'string'
			});

			// TODO
			/* add types contributed through the plug-in API */
//			var allReferences = serviceRegistry.getServiceReferences("orion.console.type");
//			for (var i = 0; i < allReferences.length; ++i) {
//				var ref = allReferences[i];
//				var service = serviceRegistry.getService(ref);
//				if (service) {
//					var type = {name: ref.getProperty("name"), parse: contributedParseFunc(service)};
//					if (service.stringify) {
//						type.stringify = service.stringify;
//					}
//					if (service.increment) {
//						type.increment = service.increment;
//					}
//					if (service.decrement) {
//						type.decrement = service.decrement;
//					}
//					console.addType(type);
//				}
//			}
			
			/* add commands contributed through the plug-in API */
			var allReferences = serviceRegistry.getServiceReferences("orion.console.command");
			for (var i = 0; i < allReferences.length; ++i) {
				var ref = allReferences[i];
				var service = serviceRegistry.getService(ref);
				if (service) {
					console.addCommand({
						name: ref.getProperty("name"),
						description: ref.getProperty("description"),
						manual: ref.getProperty("manual"),
						parameters: ref.getProperty("parameters"),
						exec: contributedExecFunc(service)
					});
				}
			}
		});
	});
});
