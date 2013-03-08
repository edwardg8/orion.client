/*******************************************************************************
 * @license
 * Copyright (c) 2013 IBM Corporation and others.
 * All rights reserved.
 * 
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/
/*global define console window*/
define(['require', 'orion/Deferred', 'orion/xhr', 'orion/form', 'orion/URL-shim'], function(require, Deferred, xhr, form, _) {
	function debug(msg) { console.log('orion injector: ' + msg); }

	function Injector(fileClient, usersClient) {
		this.fileClient = fileClient;
		this.usersClient = usersClient;
	}
	/**
	 * @param {Boolean} createUser True to create a new user should be created, false to use an existing user.
	 * @param {Object} userInfo User data for creating new user, or logging in.
	 * @param {String} [userInfo.email] Required when createUser == true, otherwise ignored.
	 * @param {String} [userInfo.Name] Required when createUser == true, otherwise ignored.
	 * @param {String} [userInfo.login] Required when !createUser, otherwise optional.
	 * @param {String} userInfo.password
	 * @param {Blob} projectZipData
	 * @param {String} projectName
	 */
	Injector.prototype.inject = function(createUser, userInfo, projectZipData, projectName) {
		projectName = projectName || 'Project';
		var fileClient = this.fileClient;
		var usersClient = this.usersClient;

		// Log in -- TODO no service API for this, so it's hardcoded
		var doLogin = function(login, password) {
			debug('logging in...');
			return xhr('POST', require.toUrl('login/form'), {
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Orion-Version': '1'
				},
				data: form.encodeFormData({
					login: login,
					password: password
				})
			}).then(function(xhrResult) {
				return JSON.parse(xhrResult.response);
			});
		};
		var ensureUserLoggedIn = function() {
			if (createUser) {
				var randomSuffix = String(Math.random()).substring(2, 12);
				var login = 'user' + randomSuffix;
				var displayName = userInfo.Name;
				var password = userInfo.Password;
				var email = 'user@' + randomSuffix;
				return usersClient.createUser(login, password, email).then(function(user) {
					debug('user created');
					return user;
				}).then(function() {
					return doLogin(login, password);
				}).then(function(user) {
					debug('set display name of ' + user.login + ' to ' + displayName);
					user.Name = displayName;
					return usersClient.updateUserInfo(user.Location, user).then(function(/*xhrResult*/) {
						return user;
					});
				});
			} else {
				return doLogin(userInfo.login, userInfo.password);
			}
		};
		// Creates project if necessary, and returns its metadata
		var ensureProjectExists = function(location, name) {
			return fileClient.createProject(location, name).then(function(p) {
				console.log('Created project: ' + p.Location);
				return fileClient.read(p.ContentLocation, true);
			}, function(e) {
				e = e.response || e;
				// This is awful, but there's no better way to check if a project exists?
				if (typeof e === 'string' && e.toLowerCase().indexOf('duplicate') !== -1) {
					return fileClient.read(location, true).then(function(workspace) {
						var projects = workspace.Children, project;
						projects.some(function(p) {
							if (p.Name === name) {
								project = p;
								console.log('Got existing project: ' + p.Location);
								return true;
							}
						});
						return project || new Deferred().reject(e);
					});
				}
				return new Deferred.reject(e);
			});
		};
		var uploadZip = function(importLocation, zipData) {
			// TODO why don't file service impls support this??
			return xhr('POST', importLocation, {
				headers: {
					Slug: 'data.zip' // Doesn't matter -- will be unzipped anyway
				},
				data: zipData
			});
		};

		return ensureUserLoggedIn().then(function() {
			return fileClient.loadWorkspace().then(function(workspace) {
				console.log('loaded workspace ' + workspace.Location);
				return ensureProjectExists(workspace.ChildrenLocation, projectName).then(function(project) {
					return fileClient.read(project.ChildrenLocation, true).then(function(projectMetadata) {
						console.log('Unzipping (importing) to ' + projectMetadata.ImportLocation);
						return uploadZip(projectMetadata.ImportLocation, projectZipData).then(function() {
							return projectMetadata;
						});
					});
				});
			});
		});
	};
	return Injector;
});