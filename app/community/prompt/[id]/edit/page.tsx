import { Container } from 'react-bootstrap'
import PromptForm from '../../prompt-form'
import { Dao } from '@/lib/db/mysql'

export default async function Edit({ params }: { params: { id: number } }) {
    const { id } = params

    const record = await Dao.retrievePromptById(id)
    if (!record) throw new Error('Prompt not found')

    return (<Container fluid={false}>
        <h1 className="mt-5 mb-3">Edição de Prompt</h1>
        <PromptForm record={record} />
    </Container>)
}
