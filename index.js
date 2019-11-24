'use strict';

const express 	= require("express")

const Validator = require('jsonschema').Validator

const path 		= require('path')

const request 	= require('request')

var optionPresets = {}

if (!Array.prototype.last){
    Array.prototype.last = function(){
        return this[this.length - 1];
    };
};

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

function checkParameters(req, desc, validator)
{
	return new Promise((resolve, reject) =>
	{
		if(desc.params)
		{
			for(var name in desc.params)
			{
				console.log(name)
				const param = desc.params[name]
				const bodyparam = req.body[name]

				//check if the parameter is required and missing
				if(param.required && !bodyparam)
				{
					const e = result(null, 
					{
						code: errcodes.BAD_REQUEST,
						msg: 'Missing parameter: ' + name 
					})

					reject(e)

					return
				}

				//parse the JSON if necessary
				if(param.type != 'string')
				{
					try
					{
						bodyparam = JSON.parse(bodyparam)

					}catch(e)
					{
						reject(result(null, 
						{
							code: errcodes.BAD_REQUEST,
							msg: 'Schema error: ' + name,
							data: 
							{
								validationError: vales.error
							} 
						}))

						return
					}
				}

				//check if the schema matches
				const valres = validator.validate(bodyparam, param)

				if(valres.errors.length != 0)
				{
					console.error(e)
					reject(result(null, 
					{
						code: errcodes.BAD_REQUEST,
						msg: 'Schema error: ' + name,
						data: 
						{
							validationError: vales.errors,
							parameter: name
						} 
					}))
				}

				req.body[param] = bodyparam
			}

			resolve()

		}else
		{
			console.log("no params")
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

		this.folder = args.folder

		this.mountpath = args.mountpath || '/'

		this.host = args.host || process.env.HOSTNAME || ''

		this.validator = new Validator()

		this.router = args.router || express.Router()

		this.routes = {}

		this.postman = args.postman

		this.protocol = args.protocol || 'http'

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

		desc.method = desc.method || 'GET'

		desc.name = desc.name || desc.route.split('/').last()

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
				console.error(e)
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


					for(var key in route.params)
					{
						const param = route.params[key]

						param.description = param.description || ''

						formdata.push(
						{
							key: key,
							type: 'text',

							description: `(${param.type}, ${param.required ? 'required' : 'optional'}) ${param.description}`
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

				if(oldRouteIndex)
				{
					newRoute._postman_id = collection.item[oldRouteIndex]._postman_id

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

					//update the collection via the postman api
					request(
					{
						url: url,
						headers:
						{
							'X-Api-Key': apiKey
						},
						method: 'PUT',
						body: JSON.stringify(collection)

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