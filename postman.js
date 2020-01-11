
const cli 		= require('node-simple-cli')
const request 	= require('request')
const path 		= require('path')
//list of postman collections and their routers
const postmanCollections = {}

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
				addToCollection(collection, routers[i])
			}
			updatePostmanCollection(apikey, collection_uid, collection).then(console.log).catch(console.error)

		}).catch((e) =>
		{
			console.error(e)
		})
	}
}

module.exports.updateAllCollections = updateAllCollections

function addRouter(router)
{
	if(!(router.postman.collection_uid in postmanCollections))
	{
		postmanCollections[router.postman.collection_uid] = []
	}

	postmanCollections[router.postman.collection_uid].push(router)
}
module.exports.addRouter = addRouter

function addToCollection(c, router)
{
	var collection = c.collection

		//replace all the requests with names matching the ones in this router
		for(var i in router.endpoints)
		{
			const route = router.endpoints[i]

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
							protocol: router.protocol,
							host: router.host,
							port: router.port,
							path: path.join(router.mountpath, route.route),
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

cli.register('pr-ud', (args) =>
{
	updateAllCollections()
})

cli.register('pr-collections', (args) =>
{
	return Object.keys(postmanCollections)
})