'use strict';

const express 	= require("express")

const Validator = require('jsonschema').Validator

const cli 		= require('node-simple-cli')

const postman	= require('./postman')

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

const ERROR_SUCCESS = error({code: errcodes.SUCCESS, msg: 'success'})

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

			var invalidJSON = false
			var bodyparamJSON = bodyparam

			//parse the JSON if necessary
			if(param.schema.type != 'string')
			{
				try
				{
					bodyparamJSON = JSON.parse(bodyparam)

				}catch(e)
				{
					invalidJSON = true
				}
			}
			
			//check if the schema matches
			const valres = validator.validate(bodyparamJSON, param.schema)

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

			body[name] = param.schema.process ? param.schema.process(bodyparamJSON) : bodyparamJSON
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

cli.register('pr-ls', (args) =>
{
	if(!args)
		return Object.keys(instances)
	
	if(args in instances)
		return instances[args]

	return 'Invalid router specified. Type pr-ls for a list of routers.'
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

			for(var i in schemas)
			{
				this.addSchema(schemas[i])
			}
		}

		if(this.postman && this.postman.collection_uid)
		{
			postman.addRouter(this)
		}	
	}

	/**
		Creates a unique name for the router
	*/
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

	getSchemas()
	{
		return this.validator.schemas
	}

}
module.exports.PostmanRouter = PostmanRouter

/**
	Returns all route objects from all routes using any of the confignames
*/
function getAllDocs(confignames)
{
	const definitions = {}

	const endpoints = {}

	for(var i in instances)
	{
		const router = instances[i]

		Object.assign(definitions, router.getSchemas())

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

	return {

		definitions: definitions,
		endpoints: endpoints,

	}
}
module.exports.getAllDocs = getAllDocs