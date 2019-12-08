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

//all properties a parameter may have in the end
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

function checkParameters(req, desc, validator)
{
	return new Promise((resolve, reject) =>
	{
		if(desc.params)
		{
			for(var name in desc.params)
			{
				const param = desc.params[name]
				var bodyparam = req.body[name]

				if(!bodyparam)
				{
					if(param.required)
					{
						const e = result(null, 
						{
							code: errcodes.BAD_REQUEST,
							msg: 'Missing parameter: ' + name 
						})

						reject(e)

						return

					}else
					{
						continue
					}
				}

				//parse the JSON if necessary
				if(param.schema.type != 'string')
				{
					try
					{
						bodyparam = JSON.parse(bodyparam)

					}catch(e)
					{
						reject(result(null, 
						{
							code: errcodes.BAD_REQUEST,
							msg: 'Invalid JSON: ' + name,
							data: 
							{
								param: name
							} 
						}))

						return
					}
				}

				//check if the schema matches
				const valres = validator.validate(bodyparam, param.schema)
				
				if(valres.errors.length != 0)
				{
					const e = result(null, 
					{
						code: errcodes.BAD_REQUEST,
						msg: 'Schema error: ' + name,
						data: 
						{
							validationError: valres.errors,
							parameter: name
						} 
					})

					reject(e)
				}

				req.body[name] = param.schema.process ? param.schema.process(bodyparam) : bodyparam
			}

			resolve()

		}else
		{
			//no parameters are required
			resolve()
		}
	})
}

//used to create default options
module.exports.options = function(name, args)
{
	optionPresets[name] = args
}

function updateAllCollections()
{
	for(var collection_iud in postmanCollections)
	{
		const routers = postmanCollections[collection_uid]

		//TODO: wow this is ugly but it works since there has to be one element in there anyway
		const apiKey = routers[0].postman.apiKey

		getPostmanCollection(apiKey, collection_iud).then((collection) =>
		{
			for(var i in routers)
			{
				routers[i].updatePostmanCollection(collection)
			}

			updatePostmanCollection(apiKey, collection_uid, collection)

		}).catch(console.error)
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
			instances[name].updatePostman()
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

	/**
		Adds a request to the API
	*/
	add(desc)
	{
		if(typeof(desc.route) != 'string')
		{
			throw 'invalid route'
		}

		for(var p in desc.params)
		{
			const param = desc.params[p]

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

			checkParameters(req, desc, this.validator).then((e) =>
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
				var oldRouteIndex = null

				for(var j in collection.item)
				{
					if(collection.item[j].name == route.name)
					{
						oldRouteIndex = j
					}
				}

				const formdata = []

				var desc = route.description

				if(route.params)
				{
					//desc += "\n### Parameters"
					var oldFormdata = null

					if(oldRouteIndex && collection.item[oldRouteIndex].request)
					{
						if(route.enctype == 'form-data')
						{
							oldFormdata = collection.item[oldRouteIndex].request.body.formdata
						}

						if(route.enctype == 'application/x-www-form-urlencoded')
						{
							oldFormdata = collection.item[oldRouteIndex].request.body.urlencoded
						}
					}

					for(var key in route.params)
					{
						const param = route.params[key]

						param.description = param.description || ''

						//inital field value
						var oldField = null

						//search for the original value if there is one
						if(oldRouteIndex)
						{
							for(var f in oldFormdata)
							{
								if(oldFormdata[f].key == key)
								{
									oldField = oldFormdata[f]
								}
							}
						}

						const exampleVal = typeof(param.example) != 'undefined' ? ( (param.schema.type) == 'string'? param.example : JSON.stringify(param.example)) : null 

						formdata.push(
						{
							key: key,
							type: 'text',
							value: exampleVal ? exampleVal : ( oldField ? oldField.value : '' ),
							description: `(${param.schema.type}, ${param.required ? 'required' : 'optional'}) ${param.description}`
						})

						/*
						desc += "\n"
						desc += `**${param.type}** ${key} *${param.required ? "required" : "optional"}* ${param.description}`
						desc += "\n\n    "
						desc += JSON.stringify(param, null, 4) + "\n"
						*/
					}
				}

				const newRoute = 
				{
					name: route.name,
					protocolProfileBehavior:
					{
						disableBodyPruning: true
					},
					request:
					{
						url: this.protocol + '://' + path.join(this.host, this.mountpath, route.route),
						description: desc,
						method: route.method,
						body:
						{
							mode: 'formdata',
							formdata: formdata
						}
					}
				}

				if(this.enctype != 'form-data')
				{
					newRoute.request.header = 
					[
						{
							key: 'Content-Type',
							name: 'Content-Type',
							value: this.enctype,
							type: 'text' 
						}
					]

					if(this.enctype == 'application/x-www-form-urlencoded')
					{
						newRoute.request.body.mode = 'urlencoded'
						newRoute.request.body.urlencoded = newRoute.request.body.formdata
						delete newRoute.request.body.formdata
					}
				}

				if(oldRouteIndex)
				{
					//keep some of the data from the current collection
					//that way we don't change the order or any values, folders etc.
					newRoute._postman_id = collection.item[oldRouteIndex]._postman_id

					newRoute.response = collection.item[oldRouteIndex].response

					//replace the route
					collection.item[oldRouteIndex] = newRoute

				}else
				{
					collection.item.push(newRoute)
				}
			}
		}
	}

	updatePostman()
	{
		return new Promise((resolve, reject) =>
		{
			const apiKey = this.postman.apikey

			const collection_uid = this.postman.collection_uid

			const url = 'https://api.getpostman.com/collections/' + collection_uid

			//get the collection
			request(
			{
				url: url,
				headers:
				{
					'X-Api-Key': apiKey
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
						resolve()
						return
					}

					//update the collection via the postman api
					request(
					{
						url: url,
						headers:
						{
							'X-Api-Key': apiKey
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

function getPostmanCollection(apiKey, collection_iud)
{
	return new Promise((resolve, reject) =>
	{
			const url = 'https://api.getpostman.com/collections/' + collection_uid

			request({
				url: url,
				headers:
				{
					'X-Api-Key': apiKey
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

function updatePostmanCollection(apiKey, collection_iud, collection)
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
					'X-Api-Key': apiKey
				},
				method: 'POST',
				body: body,

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
