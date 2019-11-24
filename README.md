# WARNING
This is an early bodgy version of what I had in mind. Use with care.

## express-postman-router
Automatically create postman collections from source code. 

## usage

```javascript

const pr = require("express-postman-router")

//define some options that we can use in multiple instances of PostmanRouter later on
pr.options('myapi', 
{
	host: 'localhost',
	protocol: 'http',
	mountpath: '/',
	postman: 
	{
		apikey: "<YOUR POSTMAN API KEY>",
		collection_uid: "<YOUR POSTMAN COLLECTION ID>"
	}
})

//set up the PostmanRouter with the previously defined options
const api = new pr.PostmanRouter({use: 'myapi'})

//add a new documented route to our api
api.add(
{
	name: 'login',	//name of the api call
	description: 'Login with your email and password', //description of the api call
	
	params: //let's define the parameters for documentation & validation
	{
		email: //use a JSON schema here. You may add the fields 'required' and 'description' to it
		{
			required: true,	//this parameter is required
			description: 'The email assiciated with the users account', //parameter description
			type: 'string', //parameter type. 
			pattern: emailRegex	//check email via regex
		},
		password:
		{
			required: true,
			type: 'string'
		}
	},
	method: 'POST',	//the request method this api call will answer to
	route: '/test/login', //the route relative to the routers mountpath
	
	//finally, what to do (only) if the parameters match the documentation above
	callback: (req, res, next) =>
	{
		res.send("OK") //do whatever in here
	}
})

//update the postman collection.
api.updatePostman()

//connect it up to our express app
app.use(api.getRouter())


```
