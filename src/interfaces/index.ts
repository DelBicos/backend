export interface User {
    id: number;
    username: string;
    email: string;
    password: string;
}

export interface Post {
    id: number;
    title: string;
    content: string;
    userId: number;
}

export interface AgendaParceiro {
    id: number;
    partnerId: number;
    availableDays: string[];
    workingHours: {
        start: string; 
        end: string;
    };
    description:string;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface Agendamento {
    id: number;
    serviceIds: number[];
    clientId: number;
    agendaId: number;
    partnerId: number;
    specialtyId: number;
    availableDate: Date;
    startTime: string;
    endTime: string;
    description: string;
    value: string;
    status: 'PENDENTE' | 'CONFIRMADO' | 'EM_DESLOCAMENTO' | 'CANCELADO' | 'CONCLUIDO';
    createdAt?: Date;
    updatedAt?: Date;
}