'use strict';

const express 	= require("express")

const Validator = require('jsonschema').Validator

const path 		= require('path')

const request 	= require('request')

const cli 		= require('node-simple-cli')

//set up toJSON for RegeExp
Object.defineProperty(RegExp.prototype, 'toJSON', 
{
	value: RegExp.prototype.toString
});

//all properties an api parameter may have in the end
const PROPS_PARAM = 
[
	'description',
	'example',
	'schema',
	'required',
]

//list of instances in order to perform operations on all of them at once
const instances = {}

//list of postman collections and their routers
const postmanCollections = {}

var optionPresets = {}

const errcodes = 
{
	UNKNOWN: -2,
	SUCCESS: 200,
	FOUND: 404,
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	INTERNAL_ERROR: 500,
}
module.exports.errcodes = errcodes

/**
	Returns an error-object
*/
function error(err = {})
{
	err.code 	= err.code 	|| errcodes.UNKNOWN
	err.msg 	= err.msg 	|| 'no error description available'
	err.data 	= err.data 	|| {}

	return err
}
module.exports.error = error

const ERROR_SUCCESS = error({code: '200'})

/**
	Returns a API-Result object
*/	
function result(res, err)
{
	if(err || !res)
	{
		return {
			error: error(err)
		}

	}else
	{
		return {
			error: ERROR_SUCCESS,
			result: res
		}
	}
}
module.exports.result = result

/**
	Returns an empty result with just an error message
*/
function errRes(code, msg='', data={})
{
	return {
		error: error({code: code, msg: msg, data: data}),
		result: null
	}	
}
module.exports.errRes = errRes

function checkRequest(req, desc, validator)
{
	return new Promise((resolve, reject) =>
	{
		var body = checkParameters(req.body, desc.params, validator)
		
		if(body) 
		{
			reject(body)
			return
		}

		var query = checkParameters(req.query, desc.query, validator)
		
		if(query) 
		{
			reject(query)
			return
		}

		var files = checkFiles(req, desc)

		if(files) 
		{
			reject(files)
			return
		}

		resolve()
		
	})
}

function checkParameters(body, params, validator)
{
	if(params)
	{
		for(var name in params)
		{
			const param = params[name]
			var bodyparam = body[name]

			if(!bodyparam)
			{
				if(param.required) return result(null, 
				{
					code: errcodes.BAD_REQUEST,
					msg: 'Missing parameter: ' + name,
					data: 
					{
						param: name
					} 
				})

				continue
			}

			//parse the JSON if necessary
			if(param.schema.type != 'string')
			{
				try
				{
					bodyparam = JSON.parse(bodyparam)

				}catch(e)
				{
					return result(null, 
					{
						code: errcodes.BAD_REQUEST,
						msg: 'Invalid JSON: ' + name,
						data: 
						{
							param: name
						} 
					})
				}
			}

			//check if the schema matches
			const valres = validator.validate(bodyparam, param.schema)

			if(valres.errors.length != 0)
			{
				return result(null, 
				{
					code: errcodes.BAD_REQUEST,
					msg: 'Schema error: ' + name,
					data: 
					{
						validationError: valres.errors,
						parameter: name
					} 
				})
			}

			body[name] = param.schema.process ? param.schema.process(bodyparam) : bodyparam
		}

	}
}

function checkFiles(req, desc)
{
	if(desc.files)
	{
		if(!req.files) req.files = {}

		for(var fname in desc.files)
		{
			const file = desc.files[fname]
				
			//check if the file is required but missing form the request
			if(file.required && !(fname in req.files))
			{
				return errRes(errcodes.BAD_REQUEST,'Missing file(s): ' + fname, { file: fname })
			}
				
			//if the file is included in the request
			if((fname in req.files))
			{
				//if a single file is submitted, treat it as an array with one entry
				if(!Array.isArray(req.files[fname]))
				{
					req.files[fname] = [req.files[fname]]
				}

				var reqFiles = req.files[fname]

				//check the mime-type for every single file
				for(var i in reqFiles)
				{
					if(file.mimetypes && !file.mimetypes.includes(reqFiles[i].mimetype) )
					{
						return errRes(errcodes.BAD_REQUEST,'Invalid mimetypes: ' + fname, { file: fname })	
					}
				}
			}
		}
	}
}

//used to create default options
module.exports.options = function(name, args)
{
	optionPresets[name] = args
}

function updateAllCollections()
{
	for(var collection_uid in postmanCollections)
	{
		const routers = postmanCollections[collection_uid]

		//TODO: wow this is ugly but it works since there has to be one element in there anyway
		const apikey = routers[0].postman.apikey

		getPostmanCollection(apikey, collection_uid).then((collection) =>
		{
			for(var i in routers)
			{
				routers[i].updatePostmanCollection(collection)
			}
			updatePostmanCollection(apikey, collection_uid, collection).then(console.log).catch(console.error)

		}).catch((e) =>
		{
			console.error(e)
		})
	}
}

module.exports.updateAllCollections = updateAllCollections



cli.register('pr-ud', (name) =>
{
	if(name == '*' || !name)
	{
		updateAllCollections()
	}else
	{
		if(name in instances)
		{
			instances[name].updatePostman().then(console.log).catch(console.error)
			return 'Started updating collection.'

		}else
		{
			return 'Invalid router specified. Type pr-ls for a list of routers.'
		}
	}
})

cli.register('pr-ls', (args) =>
{
	if(!args)
		return Object.keys(instances)
	
	if(args in instances)
		return instances[args]

	return 'Invalid router specified. Type pr-ls for a list of routers.'
})

cli.register('pr-collections', (args) =>
{
	return Object.keys(postmanCollections)

})

class PostmanRouter
{
	constructor(args)
	{
		//use preset options
		if(args.use && optionPresets[args.use])
		{
			for(var key in optionPresets[args.use])
			{
				args[key] = key in args ? args[key] : optionPresets[args.use][key]
			}
		}

		this.name = this.createName(args.name || 'PostmanRouter')
		
		instances[this.name] = this

		this.folder = args.folder

		this.mountpath = args.mountpath || '/'

		this.host = args.host || process.env.HOSTNAME || ''

		this.port = args.port || process.env.SERVER_PORT || 80

		this.validator = new Validator()

		this.router = args.router || express.Router()

		this.endpoints = {}

		this.postman = args.postman

		this.protocol = args.protocol || 'http'

		this.enctype = args.enctype || 'application/x-www-form-urlencoded'

		this.method = args.method || 'GET'

		this.use = args.use || false

		if(args.schemas)
		{
			var schemas = args.schemas

			if(typeof(schemas) == 'object')
			{
				schemas = [args.schemas]
			}

			for(var i in schemas)
			{
				this.addSchema(schemas[i])
			}
		}

		if(this.postman && this.postman.collection_uid)
		{
			if(!(this.postman.collection_uid in postmanCollections))
			{
				postmanCollections[this.postman.collection_uid] = []
			}

			postmanCollections[this.postman.collection_uid].push(this)

		}	
	}

	createName(name, counter = 0)
	{
		const newName = name + ( counter === 0 ? '' : counter)

		if(newName in instances)
		{
			return this.createName(name, counter + 1)

		}else
		{
			return newName
		}
	}

	getRouter() { return this.router }

	/**
		Adds a JSON-schema to the validator
	*/
	addSchema(schema, id = null)
	{
		this.validator.addSchema(schema, id || schema.id)
	}

	initParams(params)
	{
		for(var p in params)
		{
			const param = params[p]

			//apply inheritance
			if(param.extends)
			{
				if(!Array.isArray(typeof(param.extends)))
				{
					param.extends = [param.extends]
				}

				for(var e in param.extends)
				{
					for(var ekey in param.extends[e])
					{
						if(!(ekey in param))
						{
							param[ekey] = param.extends[e][ekey]
						}
					}
				}
				//remove all inheritance statements
				delete param.extends
			}

			//if no schema is defined, the param itself is treated as the schema
					
			if(!param.schema)
			{
				param.schema = {}

				for(var k in param)
				{
					if(!PROPS_PARAM.includes(k))
					{
						param.schema[k] = param[k]
						delete param[k]
					}
				}
			}
		}
	}

	/**
		Adds a request to the API
	*/
	add(desc)
	{
		if(typeof(desc.route) != 'string')
		{
			throw 'invalid route'
		}

		if(!desc.enctype)
		{
			desc.enctype = this.enctype
		}

		desc.params = desc.params || {}
		desc.files = desc.files || {}

		this.initParams(desc.params)
		this.initParams(desc.query)

		//add a type attribute to files in order to display the information in the collection
		//also add allowed mimetypes to desctiption
		for(var fname in desc.files)
		{
			const file = desc.files[fname]

			file.type = 'file'

			file.description = (file.mimetypes || '["*"]') + ' ' + file.description
		}

		desc.method = desc.method || this.method

		var namesplit = desc.route.split('/')

		desc.name = desc.name || namesplit[namesplit.length - 1]

		this.endpoints[desc.name] = desc

		//before executing the callbacks, make sure the specification is used correctly by the caller
		this.router.all(desc.route, (req, res, next) =>
		{
			if(req.method != desc.method)
			{
				next()
				return	
			} 

			checkRequest(req, desc, this.validator).then((e) =>
			{
				next()

			}).catch((e) =>
			{
				res.send(e)
			})
		})

		if(!Array.isArray(desc.callback))
		{
			desc.callback = [desc.callback]
		}

		for(var i in desc.callback)
		{
			const callback = desc.callback[i]
			
			switch(desc.method)
			{
				case 'POST':
					this.router.post(desc.route, callback)
					break
				
				case 'GET':
					this.router.get(desc.route, callback)
					break
			}
		}

		
	}

	updatePostmanCollection(c)
	{
		var collection = c.collection

		//replace all the requests with names matching the ones in this router
		for(var i in this.endpoints)
		{
			const route = this.endpoints[i]

			if(!route.hidden)
			{
				//original value from the collection
				var oldRoute = null
				//we need to index in order to replace it in the end
				var oldRouteIndex = null

				for(var j in collection.item)
				{
					if(collection.item[j].name == route.name)
					{
						oldRoute = collection.item[j]
						oldRouteIndex = j
					}
				}

				const formdata = []

				var desc = route.description

				var oldFormdata = null

				if(oldRoute && oldRoute.request)
				{
					if(route.enctype == 'form-data')
					{
						oldFormdata = oldRoute.request.body.formdata
					}

					if(route.enctype == 'application/x-www-form-urlencoded')
					{
						oldFormdata = oldRoute.request.body.urlencoded
					}
				}

				//join bodyparams and files into one object
				//both should be defined at this point thanks to add()
				//they should not overlap
				const params = Object.assign({}, route.params, route.files)

				//move the parameters into the formdata
				paramsToFormdata(params, formdata, oldFormdata)

				//move the query parameters into the url query//move the parameters into the formdata
				const query = []

				paramsToFormdata(route.query, query, oldRoute ? oldRoute.request.url.query : [])
				

				//the new route to add to collection.item
				const newRoute = 
				{
					name: route.name,
					protocolProfileBehavior:
					{
						disableBodyPruning: true
					},
					request:
					{
						url: 
						{
							protocol: this.protocol,
							host: this.host,
							port: this.port,
							path: path.join(this.mountpath, route.route),
							query: query
						},
						description: desc,
						method: route.method,
						//use formdata by default
						body:
						{
							mode: 'formdata',
							formdata: formdata
						},
						//initialize an empty header in order to add values
						header: []
					}
				}

				if(route.enctype != 'form-data')
				{
					newRoute.request.header.push( 
					{
						key: 'Content-Type',
						name: 'Content-Type',
						value: route.enctype,
						type: 'text' 
					})

					if(route.enctype == 'application/x-www-form-urlencoded')
					{
						newRoute.request.body.mode = 'urlencoded'
						newRoute.request.body.urlencoded = newRoute.request.body.formdata
						delete newRoute.request.body.formdata
					}

				}


				if(oldRoute)
				{
					//keep some of the data from the current collection
					//that way we don't change the order or any values, folders etc.
					newRoute._postman_id = oldRoute._postman_id

					newRoute.response = oldRoute.response

					//replace the route
					collection.item[oldRouteIndex] = newRoute

				}else
				{
					//add a new route
					collection.item.push(newRoute)
					console.log("Adding new endpoint " + route.route)
				}
			}
		}
	}

	//TODO replace this with the static methods
	updatePostman()
	{
		return new Promise((resolve, reject) =>
		{
			const apikey = this.postman.apikey

			const collection_uid = this.postman.collection_uid

			const url = 'https://api.getpostman.com/collections/' + collection_uid

			//get the collection
			request(
			{
				url: url,
				headers:
				{
					'X-Api-Key': apikey
				},
				method: 'GET'
			}, (err, res, body) =>
			{
				if(!err)
				{
					const collection = JSON.parse(body)

					//update the collection locally
					this.updatePostmanCollection(collection)

					const newCollection = JSON.stringify(collection)

					//cheap way of saying that nothing has changed
					if(newCollection == body)
					{
						console.log("Collection already up to date")
						resolve()
						return
					}

					console.log('Attempting to update collection via API')

					//update the collection via the postman api
					request(
					{
						url: url,
						headers:
						{
							'X-Api-Key': apikey
						},
						method: 'PUT',
						body: newCollection

					}, (err, res, body) =>
					{
						if(!err)
						{
							resolve(JSON.parse(body))
						}else
						{
							reject(err)
						}
					})	
				}else
				{
					reject(err)
				}
			})
		})
	}

}
module.exports.PostmanRouter = PostmanRouter

/**
	Returns all route objects from all routes using any of the confignames
*/
function getAllEndpoints(confignames)
{
	const endpoints = {}

	for(var i in instances)
	{
		const router = instances[i]

		if(!confignames || (router.use in confignames) )
		{
			for(var r in router.endpoints)
			{
				const endpoint = router.endpoints[r]
				
				endpoints[endpoint.route] = 
				{
					method: endpoint.method,
					params: endpoint.params,
				}
			}
		}
	}

	return endpoints
}
module.exports.getAllEndpoints = getAllEndpoints

function getPostmanCollection(apikey, collection_uid)
{
	return new Promise((resolve, reject) =>
	{
			const url = 'https://api.getpostman.com/collections/' + collection_uid

			request({
				url: url,
				headers:
				{
					'X-Api-Key': apikey
				},
				method: 'GET'
				}, (err, res, body) =>
				{
				if(!err)
				{
					const response = JSON.parse(body)

					if(response.collection)
					{
						resolve(response)

					}else
					{
						reject(response)
					}

				}else
				{
					reject(err)
				}
			})
		})
}

function updatePostmanCollection(apikey, collection_uid, collection)
{
	return new Promise((resolve, reject) =>
	{
		const url = 'https://api.getpostman.com/collections/' + collection_uid
			
		const body = JSON.stringify(collection)

		request(
		{
			url: url,
			headers:
			{
				'X-Api-Key': apikey
			},
			method: 'PUT',
			body: body,

		}, (err, res, body) =>
		{
			if(!err)
			{
				const response = JSON.parse(body)

				if(!response.error)
				{
					resolve(response)

				}else
				{
					reject(response)
				}

			}else
			{
				reject(err)
			}
		})
	})
}


//TODO: indentation
function paramsToFormdata(params, formdata, oldFormdata)
{
	oldFormdata = oldFormdata || []

	for(var pname in params)
	{
		const param = params[pname]

		param.description = param.description || ''

						//inital field object
					var oldField = null

					//search for the original value if there is one
					for(var fieldName in oldFormdata)
					{
						if(oldFormdata[fieldName].key == pname)
						{
							oldField = oldFormdata[fieldName]
						}
					}
						
					//set the example val if the param has one
					//if it's a string, there is no need to stringify it
					const exampleVal = typeof(param.example) != 'undefined' ? ( (param.schema.type) == 'string'? param.example : JSON.stringify(param.example)) : null 

					//add the field to the formdata
					formdata.push(
					{
						key: pname,
						type: param.type || 'text',
						//exampleVal will take priority over values set in the postman app
						value: exampleVal ? exampleVal : ( oldField ? oldField.value : param.type == 'file' ? null : '' ),
						//description containing the type, required and the parameter description
						description: `(${param.type || param.schema.type}, ${param.required ? 'required' : 'optional'}) ${param.description}`
					})
				}
}