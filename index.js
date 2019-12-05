'use strict';

const express 	= require("express")

const Validator = require('jsonschema').Validator

const path 		= require('path')

const request 	= require('request')

const cli 		= require('node-simple-cli')


//list of instances in order to perform operations on all of them at once
const instances = {}

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

module.exports.updateAllCollections = function()
{
	for(var name in instances)
	{
		console.log('Updating ' + name)
		instances[name].updatePostman()
	}
}

cli.register('pr-ud', (name) =>
{
	if(name == '*')
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

cli.register('pr-ls', () =>
{
	var res = ""

	for(var name in instances)
		res += name + "\n"

	return res
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

		this.routes = {}

		this.postman = args.postman

		this.protocol = args.protocol || 'http'

		this.enctype = args.enctype || 'application/x-www-form-urlencoded'

		this.method = args.method || 'GET'

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
		if(typeof(desc) == 'string')
		{
			desc = { route: desc }
		}

		if(typeof(desc.route) != 'string')
		{
			throw 'invalid route'
		}

		//if no schema is defined, the param itself is treated as the schema
		for(var p in desc.params)
		{
			const param = desc.params[p]

			//apply inheritance
			if(param.extends)
			{
				if(Array.isArray(typeof(param.extends)))
				{
					param.extends = [param.extends]
				}

				for(var e in param.extends)
				{
					for(var ekey in param.extends[e])
					{
						if(!(ekey in param))
						{
							param[ekey] = param.extends[ekey]
						}
					}
				}
			}

			if(!desc.params[p].schema)
			{
				desc.params[p].schema = desc.params[p]
			}
		}

		desc.method = desc.method || this.method

		var namesplit = desc.route.split('/')

		desc.name = desc.name || namesplit[namesplit.length - 1]

		this.routes[desc.name] = desc

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
				desc.callback(req, res, next)

			}).catch((e) =>
			{
				res.send(e)
			})
		})
	}

	updatePostmanCollection(c)
	{
		var collection = c.collection

		//replace all the requests with names matching the ones in this router
		for(var i in this.routes)
		{
			const route = this.routes[i]

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

	readPostmanCollection()
	{
		return new Promise((resolve, reject) =>
		{
			if(this.postman)
			{
				if(this.postman.mode == 'API')
				{
					const apiKey = this.postman.apikey

					const collection_uid = this.postman.collection_uid

					const url = 'https://api.getpostman.com/collections/' + collection_uid

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

				}else if(this.postman.mode == 'FILE')
				{
					reject('File mode is not yet supported!')
				}

			}else
			{
				reject()
			}
		})
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

