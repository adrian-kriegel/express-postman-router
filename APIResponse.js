
class APIError
{
	constructor(code, msg, data = {})
	{
		this._code = code
		this._msg = msg
		this._data = data
	}

	msg(str)
	{
		this._msg = str
		return this
	}

	data(obj)
	{
		this._data = obj
		return this
	}

	toJSON()
	{
		return { code: this._code, msg: this._msg, data: this._data }
	}
}
module.exports.APIError = APIError

/*
	Pre-made Error-Objects
*/
const ERRORS = 
{
	SUCCESS: 		() => { return new APIError(200, 'success') },
	INTERNAL: 		() => { return new APIError(500, 'internal server error') },
	NOT_FOUND: 		() => { return new APIError(404, 'not found') },
	BAD_REQUEST: 	() => { return new APIError(400, 'bad request') },
	UNAUTHORIZED: 	() => { return new APIError(401, 'unauthorized') },
	FORBIDDEN: 		() => { return new APIError(403, 'forbidden') },
}
module.exports.ERRORS = ERRORS

class APIResponse
{
	constructor(result, error = ERRORS.SUCCESS())
	{
		//check if result is an APIResponse
		if(result && typeof(result) == 'object' && ('error' in result || 'result' in result))
		{
			console.error(new Error('returning full APIResponse is deprecated'))
			error = result.error || error
			result = result.result
		}

		this.result = result
		this.error = error
	}
}
module.exports.APIResponse = APIResponse

function handleError(req, res, e)
{
	var error = null
	
	//check if the error is an Exception or an APIError
	if(e instanceof Error)
	{
		//log the circumstances
		console.error('Internal error in ' + req.route.path)
		console.error(e)
		console.error('Request: ')
		console.error(JSON.stringify(req.body))

		//send an internal error to the client
		error = ERRORS.INTERNAL()
			
	}else
	{

		//check if e is deprecated form of APIResponse or APIError
		if(e instanceof APIError)
		{
			error = e

		}else
		{
			console.error('Throwing Objects/APIResponse is deprecated.')
		
			if(e.error)
			{
				error = e.error

			}else
			{
				console.error(e)
				throw new Error(e)
			}
		}

	}

	//add Error data about the endpoint
	if(!error.data)
		error.data = {}

	error.data.endpoint = req.originalUrl

	res.send(new APIResponse(null, error))
}
module.exports.handleError = handleError